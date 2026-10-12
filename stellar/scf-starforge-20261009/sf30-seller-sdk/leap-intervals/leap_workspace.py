"""MIT. Durable source, interval preparation, and same-upload recovery."""
from __future__ import annotations
import csv
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
import threading
from uuid import uuid4
from datetime import datetime, timedelta, timezone

from leap_contracts import (
    SCHEMA, LOAD_COLUMNS, OPTIONAL_COLUMNS, ENERGY_COLUMNS, MAX_SOURCE_BYTES,
    LeapError, require, json_bytes, now_text, sha_value, identifier,
    mapping_document, mapping_index, profile_row, validate_load, csv_rows,
    instant, utc_text, cutoff, text_value,
)

COLLECTIONS = {"imports", "mappings", "batches", "missing_snapshots", "api_receipts", "meters", "original_files", "exports", "files"}
REMOTE_ACTIONS = {"batch.submit", "batch.refresh", "batch.reconcile", "missing.refresh"}


def digest_file(path):
    total, digest = 0, hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            total += len(block)
            digest.update(block)
    return total, digest.hexdigest()


class LeapWorkspace:
    def __init__(self, directory):
        self.root = Path(directory).absolute()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and not self.root.is_symlink() and info.st_uid == os.getuid()
                and info.st_mode & 0o077 == 0, "LOCAL_WORKSPACE", "Choose an owner-private workspace directory.")
        self.lock = os.open(self.root / ".leap.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            os.close(self.lock)
            raise LeapError("LOCAL_WORKSPACE_BUSY", "Use the original running workspace connection.") from error
        self.mutex = threading.RLock()
        for name in ("blobs", "exports", "staging"):
            path = self.root / name
            path.mkdir(mode=0o700, exist_ok=True)
            require(not path.is_symlink() and path.is_dir() and path.stat().st_uid == os.getuid()
                    and path.stat().st_mode & 0o077 == 0, "LOCAL_WORKSPACE", "The workspace contains a nonprivate directory.")
        dbfile = self.root / "leap.sqlite"
        if dbfile.exists() or dbfile.is_symlink():
            info = dbfile.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
                    and info.st_mode & 0o077 == 0, "LOCAL_WORKSPACE", "The original workspace database must remain private and regular.")
        old_mask = os.umask(0o077)
        try:
            self.db = sqlite3.connect(dbfile, isolation_level=None, check_same_thread=False)
        finally:
            os.umask(old_mask)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS objects (collection TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(collection,id));
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS batch_rows (batch_id TEXT NOT NULL,row_index INTEGER NOT NULL,meter_id TEXT NOT NULL,
          start_us INTEGER NOT NULL,end_us INTEGER NOT NULL,document TEXT NOT NULL,
          PRIMARY KEY(batch_id,meter_id,start_us,end_us));
        CREATE INDEX IF NOT EXISTS batch_row_order ON batch_rows(batch_id,row_index);
        CREATE TABLE IF NOT EXISTS issues (id INTEGER PRIMARY KEY,batch_id TEXT NOT NULL,document TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS batch_issues ON issues(batch_id,id);
        CREATE TABLE IF NOT EXISTS job_errors (job_id TEXT NOT NULL,row_index INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(job_id,row_index));
        CREATE TABLE IF NOT EXISTS missing_rows (snapshot_id TEXT NOT NULL,row_index INTEGER NOT NULL,meter_id TEXT,
          start_us INTEGER,end_us INTEGER,status TEXT,data_type TEXT,document TEXT NOT NULL,PRIMARY KEY(snapshot_id,row_index));
        CREATE INDEX IF NOT EXISTS missing_intervals ON missing_rows(snapshot_id,meter_id,start_us,end_us);
        """)
        if self.meta("schema") is None:
            self.setmeta("schema", SCHEMA)
            self.setmeta("workspace_id", str(uuid4()))
            self.setmeta("revision", 0)
            self.setmeta("config", {"environment": "staging", "partner_account_id": "", "token_env": "LEAP_API_TOKEN"})
        require(self.meta("schema") == SCHEMA, "LOCAL_SCHEMA", "Open this workspace with its original application.")
        # The exclusive lock proves the prior owner has ended.
        for batch in self.documents("batches"):
            if batch["status"] == "SENDING":
                batch.update(status="UNKNOWN", interrupted_at=now_text())
                self.put("batches", batch["id"], batch)

    def close(self):
        with self.mutex:
            self.db.close()
            fcntl.flock(self.lock, fcntl.LOCK_UN)
            os.close(self.lock)

    def meta(self, key):
        row = self.db.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def setmeta(self, key, value):
        self.db.execute("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json_bytes(value).decode()))

    def put(self, collection, ident, document):
        require(collection in COLLECTIONS, "LOCAL_COLLECTION", "Choose an original application collection.")
        self.db.execute("INSERT INTO objects(collection,id,document) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET document=excluded.document",
                        (collection, ident, json_bytes(document).decode()))

    def get(self, collection, ident):
        require(collection in COLLECTIONS, "LOCAL_COLLECTION", "Choose an original application collection.")
        row = self.db.execute("SELECT document FROM objects WHERE collection=? AND id=?", (collection, ident)).fetchone()
        require(row is not None, "LOCAL_NOT_FOUND", "This original workspace item was not found.", collection=collection, id=ident)
        return json.loads(row[0])

    def documents(self, collection):
        require(collection in COLLECTIONS, "LOCAL_COLLECTION", "Choose an original application collection.")
        for row in self.db.execute("SELECT document FROM objects WHERE collection=? ORDER BY rowid", (collection,)):
            yield json.loads(row[0])

    def configuration(self):
        config = self.meta("config")
        require(config["environment"] in {"staging", "production"} and config["partner_account_id"],
                "LOCAL_CONFIGURATION", "Save the intended partner account and environment.")
        return config

    def configure(self, payload):
        require(isinstance(payload, dict) and set(payload) <= {"environment", "partner_account_id", "token_env"},
                "LOCAL_CONFIGURATION", "Save only the account, environment and API-key environment-variable name.")
        config = {"environment": payload.get("environment"),
                  "partner_account_id": text_value(payload.get("partner_account_id"), "Partner account ID", 128),
                  "token_env": payload.get("token_env", "LEAP_API_TOKEN")}
        require(config["environment"] in {"staging", "production"} and isinstance(config["token_env"], str)
                and re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", config["token_env"]),
                "LOCAL_CONFIGURATION", "Choose staging or production and a named API-key environment variable.")
        previous = self.meta("config")
        require(not any(batch.get("job_id") or batch["status"] in {"UNKNOWN", "SENDING", "SUBMITTED"}
                        for batch in self.documents("batches"))
                or (previous["environment"], previous["partner_account_id"]) == (config["environment"], config["partner_account_id"]),
                "LOCAL_ACCOUNT_BINDING", "Reopen this delivery with its original partner account and environment.")
        self.setmeta("config", config)
        return config

    def store_stream(self, stream, name, kind, *, expected_bytes=None, maximum=MAX_SOURCE_BYTES):
        name = text_value(name, "Original filename", 240)
        require(not any(char in name for char in "/\\\r\n") and name not in {".", ".."},
                "LOCAL_FILENAME", "Use a plain original filename.")
        if expected_bytes is not None:
            require(0 <= expected_bytes <= maximum, "LOCAL_CAPACITY", "The original file exceeds the selected receiving capacity.")
        fd, temporary = tempfile.mkstemp(prefix=".source-", dir=self.root / "staging")
        size, digest = 0, hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as out:
                while True:
                    block = stream.read(1024 * 1024)
                    if not block:
                        break
                    require(isinstance(block, bytes), "LOCAL_SOURCE", "Supply original file bytes.")
                    size += len(block)
                    require(size <= maximum, "LOCAL_CAPACITY", "The original file exceeds the selected receiving capacity.")
                    digest.update(block)
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            require(expected_bytes is None or size == expected_bytes, "LOCAL_SOURCE_TRUNCATED", "The source ended before its declared complete byte length.")
            ident = digest.hexdigest()
            destination = self.root / "blobs" / ident
            try:
                os.link(temporary, destination)
            except FileExistsError:
                self.blob_path(ident)
            finally:
                os.unlink(temporary)
            meta = {"id": ident, "name": name, "bytes": size, "sha256": ident, "kind": kind,
                    "download_url": "/api/file?id=" + ident, "created_at": now_text()}
            old = self.db.execute("SELECT document FROM objects WHERE collection='files' AND id=?", (ident,)).fetchone()
            if old is None:
                self.put("files", ident, meta)
            return meta
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def store_bytes(self, data, name, kind):
        return self.store_stream(io.BytesIO(data), name, kind, expected_bytes=len(data))

    def blob_path(self, ident):
        sha_value(ident, "Original file")
        path = self.root / "blobs" / ident
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
                and info.st_mode & 0o077 == 0, "LOCAL_SOURCE", "The retained original must remain a private regular file.")
        size, actual = digest_file(path)
        require(actual == ident, "LOCAL_SOURCE_CHANGED", "The retained original bytes changed.", expected_sha256=ident, actual_sha256=actual)
        return path

    def register_source(self, payload):
        blob = self.get("files", sha_value(payload.get("id"), "Original source"))
        self.blob_path(blob["id"])
        require(payload.get("format") in {"leap-load", "utility-profile", "evidence"}, "LOCAL_FORMAT", "Choose the complete source format.")
        old = self.db.execute("SELECT document FROM objects WHERE collection='imports' AND id=?", (blob["id"],)).fetchone()
        if old:
            original = json.loads(old[0])
            require(original["format"] == payload["format"], "LOCAL_SOURCE_FORMAT", "The same original bytes already have a selected source format.")
            return original
        value = {**blob, "format": payload["format"], "name": text_value(payload.get("name", blob["name"]), "Original filename", 240)}
        self.put("imports", value["id"], value)
        return value

    def save_mapping(self, payload):
        value = mapping_document(payload)
        evidence = self.get("imports", value["ownership_evidence_source_id"])
        require(evidence["format"] == "evidence", "LOCAL_OWNERSHIP", "Select the retained partner ownership evidence document.")
        config = self.configuration()
        require((value["environment"], value["partner_account_id"]) == (config["environment"], config["partner_account_id"]),
                "LOCAL_MAPPING_ACCOUNT", "The mapping must use this workspace's partner account and environment.")
        ident = hashlib.sha256(json_bytes(value)).hexdigest()
        self.put("mappings", ident, {**value, "id": ident, "created_at": now_text()})
        return self.get("mappings", ident)

    def add_issue(self, batch_id, document):
        self.db.execute("INSERT INTO issues(batch_id,document) VALUES(?,?)", (batch_id, json_bytes(document).decode()))

    def prepare(self, payload, request_id):
        require(isinstance(payload, dict) and isinstance(payload.get("source_ids"), list) and payload["source_ids"],
                "LOCAL_PREPARE", "Select complete original source files and their reviewed mapping.")
        source_ids = payload["source_ids"]
        require(len(source_ids) == len(set(source_ids)), "LOCAL_PREPARE", "Choose each original source once.")
        mapping = self.get("mappings", sha_value(payload.get("mapping_id"), "Reviewed mapping"))
        config = self.configuration()
        require((mapping["environment"], mapping["partner_account_id"]) == (config["environment"], config["partner_account_id"]),
                "LOCAL_MAPPING_ACCOUNT", "The reviewed mapping belongs to a different partner account or environment.")
        if payload.get("correction_of"):
            parent = self.get("batches", sha_value(payload["correction_of"], "Original rejected batch"))
            require(parent["status"] in {"FAILED", "REJECTED", "VALIDATION_FAILED"}, "LOCAL_CORRECTION",
                    "Select the original rejected file for a complete corrected edition.")
        snapshot_id = payload.get("missing_snapshot_id")
        if snapshot_id:
            snapshot = self.get("missing_snapshots", sha_value(snapshot_id, "Missing-window snapshot"))
            require(snapshot["status"] == "COMPLETE" and snapshot["environment"] == config["environment"]
                    and snapshot["partner_account_id"] == config["partner_account_id"],
                    "LOCAL_MISSING_SNAPSHOT", "Use a complete missing-window search from this partner account.")
        ident = hashlib.sha256(("leap-batch:" + request_id).encode()).hexdigest()
        clock = now_text()
        batch = {"id": ident, "name": text_value(payload.get("name"), "Batch name"),
                 "status": "PREPARING", "source_ids": source_ids, "mapping_id": mapping["id"],
                 "environment": config["environment"], "partner_account_id": config["partner_account_id"],
                 "created_at": clock, "clock_utc": clock, "row_count": 0, "issue_count": 0, "meter_count": 0,
                 "correction_of": payload.get("correction_of"), "missing_snapshot_id": snapshot_id,
                 "source_rows": 0, "excluded_rows": 0, "exclusion_reasons": {}}
        self.put("batches", ident, batch)
        index = mapping_index(mapping)
        next_index = 0
        for source_id in source_ids:
            imported = self.get("imports", sha_value(source_id, "Original source"))
            require(imported["format"] in {"leap-load", "utility-profile"}, "LOCAL_SOURCE_FORMAT", "Select original interval CSV sources.")
            try:
                for source_line, original in csv_rows(self.blob_path(source_id), imported["format"]):
                    batch["source_rows"] += 1
                    origin = {"source_id": source_id, "source_line": source_line}
                    if original.get("source_row_id"):
                        origin["source_row_id"] = original["source_row_id"]
                    try:
                        target = None
                        if imported["format"] == "utility-profile":
                            row, target = profile_row(original, index)
                        else:
                            row = {key: original.get(key, "") for key in LOAD_COLUMNS + OPTIONAL_COLUMNS}
                        meter_id = identifier(row["meter_id"])
                        start, end = instant(row["interval_start_time_utc"]), instant(row["interval_end_time_utc"])
                        if snapshot_id:
                            reason = self.missing_exclusion(snapshot_id, meter_id, start, end)
                            if reason:
                                batch["excluded_rows"] += 1
                                batch["exclusion_reasons"][reason] = batch["exclusion_reasons"].get(reason, 0) + 1
                                continue
                        existing = self.db.execute("SELECT row_index,document FROM batch_rows WHERE batch_id=? AND meter_id=? AND start_us=? AND end_us=?",
                                                   (ident, meter_id, start, end)).fetchone()
                        if existing:
                            old = json.loads(existing["document"])
                            if target is None or old.get(target, "") != "":
                                self.add_issue(ident, {"row_index": existing["row_index"], **origin, "meter_id": meter_id,
                                                       "code": "LOCAL_DUPLICATE_INTERVAL", "column": target or "meter_id",
                                                       "message": "Choose one source edition for this complete device interval and energy column."})
                                continue
                            old[target] = row[target]
                            old["origins"].append(origin)
                            self.db.execute("UPDATE batch_rows SET document=? WHERE batch_id=? AND meter_id=? AND start_us=? AND end_us=?",
                                            (json_bytes(old).decode(), ident, meter_id, start, end))
                        else:
                            next_index += 1
                            row.update(meter_id=meter_id, origins=[origin], row_index=next_index)
                            self.db.execute("INSERT INTO batch_rows VALUES(?,?,?,?,?,?)",
                                            (ident, next_index, meter_id, start, end, json_bytes(row).decode()))
                    except (LeapError, ValueError, TypeError) as error:
                        detail = error.as_dict() if isinstance(error, LeapError) else {"code": "LOCAL_SOURCE_ROW", "message": str(error)}
                        self.add_issue(ident, {"row_index": None, **origin, **detail})
            except (LeapError, ValueError, TypeError, UnicodeError) as error:
                detail = error.as_dict() if isinstance(error, LeapError) else {"code": "LOCAL_SOURCE_CSV", "message": str(error)}
                self.add_issue(ident, {"row_index": None, "source_id": source_id, **detail})
        clock_us = instant(clock)
        optional = set()
        for row_index, saved in enumerate(self.db.execute("SELECT meter_id,start_us,end_us,document FROM batch_rows WHERE batch_id=? ORDER BY row_index", (ident,)), 1):
            row = json.loads(saved["document"])
            wire, issues = validate_load(row, mapping, clock_us)
            wire.update(origins=row["origins"], row_index=row_index)
            optional.update(key for key in OPTIONAL_COLUMNS if wire[key] != "")
            self.db.execute("UPDATE batch_rows SET row_index=?,document=? WHERE batch_id=? AND meter_id=? AND start_us=? AND end_us=?",
                            (row_index, json_bytes(wire).decode(), ident, saved["meter_id"], saved["start_us"], saved["end_us"]))
            for issue in issues:
                self.add_issue(ident, {"row_index": row_index, "meter_id": saved["meter_id"], **issue})
        summary = self.db.execute("SELECT COUNT(*),COUNT(DISTINCT meter_id),MIN(start_us),MAX(end_us) FROM batch_rows WHERE batch_id=?", (ident,)).fetchone()
        batch.update(row_count=summary[0], meter_count=summary[1], first_start_utc=utc_text(summary[2]) if summary[2] is not None else None,
                     last_end_utc=utc_text(summary[3]) if summary[3] is not None else None)
        if not batch["row_count"]:
            self.add_issue(ident, {"row_index": None, "code": "LOCAL_EMPTY_BATCH", "column": "", "message": "Select at least one complete eligible device interval."})
        batch["issue_count"] = self.db.execute("SELECT COUNT(*) FROM issues WHERE batch_id=?", (ident,)).fetchone()[0]
        batch["status"] = "VALIDATION_FAILED" if batch["issue_count"] else "PREPARED"
        columns = LOAD_COLUMNS + tuple(key for key in OPTIONAL_COLUMNS if key in optional)
        fd, filename = tempfile.mkstemp(prefix=".load-", dir=self.root / "staging")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as out:
                writer = csv.DictWriter(out, fieldnames=columns, lineterminator="\n")
                writer.writeheader()
                for saved in self.db.execute("SELECT document FROM batch_rows WHERE batch_id=? ORDER BY row_index", (ident,)):
                    row = json.loads(saved[0])
                    writer.writerow({key: row[key] for key in columns})
                out.flush()
                os.fsync(out.fileno())
            with open(filename, "rb") as source:
                batch["upload"] = self.store_stream(source, "leap-load-" + ident[:16] + ".csv", "prepared-upload")
        finally:
            os.unlink(filename)
        batch["wire_columns"] = list(columns)
        if snapshot_id:
            batch["missing_coverage"] = self.coverage(snapshot_id, ident)
        self.put("batches", ident, batch)
        return batch

    def missing_exclusion(self, snapshot_id, meter_id, start, end):
        rows = self.db.execute("SELECT start_us,end_us,status FROM missing_rows WHERE snapshot_id=? AND meter_id=? AND data_type='LOAD_DATA' AND start_us<? AND end_us>?",
                               (snapshot_id, meter_id, end, start)).fetchall()
        if any(row["status"] == "PENDING" for row in rows):
            return "PENDING"
        if any(row["status"] == "OPEN" and row["start_us"] <= start and end <= row["end_us"] for row in rows):
            return None
        return "OUTSIDE_OPEN_LOAD_WINDOW"

    def coverage(self, snapshot_id, batch_id):
        report = {"open_windows": 0, "pending_windows": 0, "open_windows_fully_covered": 0, "open_windows_remaining": 0}
        for row in self.db.execute("SELECT * FROM missing_rows WHERE snapshot_id=? AND data_type='LOAD_DATA'", (snapshot_id,)):
            if row["status"] == "PENDING":
                report["pending_windows"] += 1
                continue
            if row["status"] != "OPEN":
                continue
            report["open_windows"] += 1
            cursor = row["start_us"]
            for interval in self.db.execute("SELECT start_us,end_us FROM batch_rows WHERE batch_id=? AND meter_id=? AND start_us>=? AND end_us<=? ORDER BY start_us",
                                            (batch_id, row["meter_id"], row["start_us"], row["end_us"])):
                if interval["start_us"] != cursor:
                    break
                cursor = interval["end_us"]
            report["open_windows_fully_covered" if cursor == row["end_us"] else "open_windows_remaining"] += 1
        return report

    def api_batch(self, batch_id):
        batch = self.get("batches", sha_value(batch_id, "Original batch"))
        config = self.configuration()
        require((batch["environment"], batch["partner_account_id"]) == (config["environment"], config["partner_account_id"]),
                "LOCAL_BATCH_ACCOUNT", "Reopen the batch in its original partner account and environment.")
        return batch

    def refresh_missing(self, filters, request_id):
        from leap_api import LeapAPI
        api = LeapAPI(self)
        ident = hashlib.sha256(("leap-missing:" + request_id).encode()).hexdigest()
        config = self.configuration()
        snapshot = {"id": ident, "status": "RECEIVING", "created_at": now_text(), "filters": filters,
                    "environment": config["environment"], "partner_account_id": config["partner_account_id"],
                    "row_count": 0, "pages": [], "unusable_rows": 0}
        self.put("missing_snapshots", ident, snapshot)
        try:
            for rows, receipt in api.missing_pages(filters):
                snapshot["pages"].append(receipt)
                self.db.execute("BEGIN IMMEDIATE")
                try:
                    for row in rows:
                        snapshot["row_count"] += 1
                        parsed = {"meter_id": None, "start_us": None, "end_us": None, "status": None, "data_type": None}
                        try:
                            require(isinstance(row, dict), "LEAP_MISSING_ROW", "A missing-window row must be an object.")
                            parsed.update(meter_id=identifier(row.get("meter_id")), start_us=instant(row.get("start_date_time_utc")),
                                          end_us=instant(row.get("end_date_time_utc")), status=row.get("status"), data_type=row.get("data_type"))
                            require(parsed["start_us"] < parsed["end_us"] and parsed["status"] in {"OPEN", "PENDING"}
                                    and parsed["data_type"] in {"LOAD_DATA", "RUNTIME_DATA", "PERFORMANCE_DATA"},
                                    "LEAP_MISSING_ROW", "The missing-window row has an unusable period, status or data type.")
                            instant(row.get("submission_deadline_date_time_utc"))
                        except (ValueError, TypeError):
                            snapshot["unusable_rows"] += 1
                        self.db.execute("INSERT INTO missing_rows VALUES(?,?,?,?,?,?,?,?)",
                                        (ident, snapshot["row_count"], parsed["meter_id"], parsed["start_us"], parsed["end_us"],
                                         parsed["status"], parsed["data_type"], json_bytes(row).decode()))
                    self.put("missing_snapshots", ident, snapshot)
                    self.db.execute("COMMIT")
                except BaseException:
                    self.db.execute("ROLLBACK")
                    raise
            snapshot.update(status="COMPLETE" if not snapshot["unusable_rows"] else "INCOMPLETE_ROWS", completed_at=now_text())
        except Exception as error:
            snapshot.update(status="INTERRUPTED", error=self.error_document(error), interrupted_at=now_text())
            self.put("missing_snapshots", ident, snapshot)
            return snapshot
        self.put("missing_snapshots", ident, snapshot)
        return snapshot

    def submit(self, payload, request_id):
        from leap_api import LeapAPI, ProviderError
        batch = self.api_batch(payload.get("batch_id"))
        if batch.get("job_id"):
            return batch
        require(batch["status"] in {"PREPARED", "DEFERRED", "AUTHENTICATION_REQUIRED"},
                "LOCAL_SUBMIT_STATE", "Select a prepared batch, or reconcile its existing upload.")
        require(batch["issue_count"] == 0 and batch["row_count"] > 0, "LOCAL_VALIDATION", "Resolve the complete file's interval issues.")
        clock = instant(now_text())
        require(instant(batch["first_start_utc"]) >= cutoff(clock) and instant(batch["last_end_utc"]) <= clock,
                "LOCAL_INTERVAL_AGE", "Prepare a current eligible edition of the original intervals.")
        duplicate = [other["id"] for other in self.documents("batches")
                     if other["id"] != batch["id"] and other.get("upload", {}).get("sha256") == batch["upload"]["sha256"]
                     and (other["environment"], other["partner_account_id"]) == (batch["environment"], batch["partner_account_id"])
                     and (other.get("job_id") or other["status"] in {"UNKNOWN", "SENDING"})]
        if duplicate:
            batch.update(status="DUPLICATE_REVIEW", matching_batch_ids=duplicate)
            self.put("batches", batch["id"], batch)
            return batch
        if batch.get("correction_of"):
            parent = self.get("batches", batch["correction_of"])
            require(parent["upload"]["sha256"] != batch["upload"]["sha256"], "LOCAL_UNCHANGED_CORRECTION",
                    "Keep the original rejected file and select its complete corrected edition.")
        api = LeapAPI(self)
        batch["meter_receipts"] = []
        try:
            for row in self.db.execute("SELECT DISTINCT meter_id FROM batch_rows WHERE batch_id=? ORDER BY meter_id", (batch["id"],)):
                meter, receipt = api.meter(row["meter_id"])
                self.put("meters", row["meter_id"], {"id": row["meter_id"], "meter": meter, "receipt_id": receipt,
                                                    "environment": batch["environment"], "partner_account_id": batch["partner_account_id"],
                                                    "observed_at": now_text()})
                batch["meter_receipts"].append(receipt)
                self.put("batches", batch["id"], batch)
            if batch.get("missing_snapshot_id"):
                original = self.get("missing_snapshots", batch["missing_snapshot_id"])
                current = self.refresh_missing(original["filters"], str(uuid4()))
                batch["submission_missing_snapshot_id"] = current["id"]
                require(current["status"] == "COMPLETE", "LOCAL_MISSING_REFRESH", "Receive the complete current missing-window search.")
                changed = 0
                for row in self.db.execute("SELECT meter_id,start_us,end_us FROM batch_rows WHERE batch_id=?", (batch["id"],)):
                    if self.missing_exclusion(current["id"], row["meter_id"], row["start_us"], row["end_us"]):
                        changed += 1
                if changed:
                    batch.update(status="NEEDS_REPLAN", changed_missing_intervals=changed)
                    self.put("batches", batch["id"], batch)
                    return batch
        except Exception as error:
            batch.update(last_error=self.error_document(error), status="DEFERRED" if getattr(error, "status", None) == 429
                         else "AUTHENTICATION_REQUIRED" if getattr(error, "status", None) in {401, 403} else "ELIGIBILITY_REVIEW")
            self.put("batches", batch["id"], batch)
            return batch
        self.blob_path(batch["upload"]["id"])
        batch.update(status="SENDING", attempt_started_at=now_text(), submit_request_id=request_id)
        self.put("batches", batch["id"], batch)
        try:
            job_id, receipt = api.upload(batch["upload"]["id"])
            batch.update(status="SUBMITTED", job_id=job_id, upload_receipt_id=receipt, accepted_at=now_text())
        except Exception as error:
            detail = self.error_document(error)
            status = getattr(error, "status", None)
            if isinstance(error, ProviderError) and not error.uncertain and status in {400, 401, 403, 429}:
                state = "DEFERRED" if status == 429 else "AUTHENTICATION_REQUIRED" if status in {401, 403} else "REJECTED"
            else:
                state = "UNKNOWN"
            batch.update(status=state, last_error=detail, last_attempt_returned_at=now_text())
        self.put("batches", batch["id"], batch)
        return batch

    def refresh(self, payload):
        from leap_api import LeapAPI
        batch = self.api_batch(payload.get("batch_id"))
        require(batch.get("job_id"), "LOCAL_JOB_ID", "Reconcile the original upload to its provider job first.")
        api = LeapAPI(self)
        jobs, receipts = [], []
        try:
            for rows, receipt in api.upload_pages(**{"job_id[]": [batch["job_id"]]}):
                receipts.append(receipt)
                jobs.extend(row for row in rows if row["last_job_id"].lower() == batch["job_id"])
            batch.update(provider_jobs=jobs, status_receipts=receipts, status_observed_at=now_text())
            if len(jobs) == 1:
                batch["status"] = jobs[0]["status"]
                if batch["status"] == "FAILED":
                    errors, receipt = api.errors(batch["job_id"])
                    self.db.execute("BEGIN IMMEDIATE")
                    try:
                        self.db.execute("DELETE FROM job_errors WHERE job_id=?", (batch["job_id"],))
                        self.db.executemany("INSERT INTO job_errors(job_id,row_index,document) VALUES(?,?,?)",
                                            [(batch["job_id"], index, json_bytes(row).decode()) for index, row in enumerate(errors["errors"], 1)])
                        self.db.execute("COMMIT")
                    except BaseException:
                        self.db.execute("ROLLBACK")
                        raise
                    batch.update(error_receipt_id=receipt, provider_error_count=len(errors["errors"]),
                                 error_summary=errors.get("error_summary"), error_csv_file_path=errors.get("error_csv_file_path"))
            else:
                batch["status_detail"] = "JOB_NOT_VISIBLE" if not jobs else "MULTIPLE_STATUS_ROWS"
            batch.pop("last_error", None)
        except Exception as error:
            batch["last_error"] = self.error_document(error)
        self.put("batches", batch["id"], batch)
        return batch

    def reconcile(self, payload):
        from leap_api import LeapAPI
        batch = self.api_batch(payload.get("batch_id"))
        if batch.get("job_id"):
            return self.refresh(payload)
        require(batch["status"] in {"UNKNOWN", "SENDING"} and batch.get("attempt_started_at"),
                "LOCAL_RECONCILE", "Choose the original interrupted provider submission.")
        api = LeapAPI(self)
        candidate_ids, matches, receipts, candidates = [], [], [], []
        selected = payload.get("job_id")
        try:
            if selected:
                candidate_ids = [identifier(selected, "Original provider job ID")]
            else:
                start = datetime.fromisoformat(batch["attempt_started_at"].replace("Z", "+00:00")) - timedelta(minutes=2)
                for rows, receipt in api.upload_pages(**{"from": start.isoformat().replace("+00:00", "Z"), "to": now_text()}):
                    receipts.append(receipt)
                    candidates.extend(rows)
                    for row in rows:
                        if row["last_job_id"] not in candidate_ids:
                            candidate_ids.append(row["last_job_id"])
            for job_id in candidate_ids:
                saved = self.db.execute("SELECT document FROM objects WHERE collection='original_files' AND id=?", (job_id,)).fetchone()
                if saved:
                    file = json.loads(saved[0])["file"]
                    self.blob_path(file["id"])
                else:
                    file = api.original_file(job_id)
                if file["sha256"] == batch["upload"]["sha256"] and file["bytes"] == batch["upload"]["bytes"]:
                    matches.append({"job_id": job_id, "file": file})
            batch["reconciliation"] = {"completed_at": now_text(), "complete": True, "candidate_count": len(candidate_ids),
                                       "candidate_jobs": candidates, "status_receipts": receipts, "exact_matches": matches}
            if len(matches) == 1:
                batch.update(job_id=matches[0]["job_id"], status="SUBMITTED", reconciled_at=now_text())
            else:
                batch.update(status="UNKNOWN", status_detail="NO_EXACT_FILE_MATCH" if not matches else "MULTIPLE_EXACT_FILE_MATCHES")
        except Exception as error:
            batch["reconciliation"] = {"complete": False, "observed_at": now_text(), "candidate_count": len(candidate_ids),
                                       "status_receipts": receipts, "exact_matches": matches, "error": self.error_document(error)}
        self.put("batches", batch["id"], batch)
        return self.refresh({"batch_id": batch["id"]}) if batch.get("job_id") else batch

    def operation(self, ident):
        identifier(ident, "Request ID")
        row = self.db.execute("SELECT document FROM operations WHERE id=?", (ident,)).fetchone()
        require(row is not None, "LOCAL_OPERATION_NOT_FOUND", "This request has not been accepted by the original workspace.")
        return json.loads(row[0])

    @staticmethod
    def error_document(error):
        if isinstance(error, LeapError):
            return error.as_dict()
        return {"code": "LOCAL_OPERATION_ERROR", "message": str(error)[:2000], "type": type(error).__name__}

    def perform(self, action, payload, request_id=None, expected_revision=None):
        require(isinstance(action, str) and isinstance(payload, dict), "LOCAL_ACTION", "Use a named action and its complete JSON payload.")
        request_id = identifier(request_id or str(uuid4()), "Request ID")
        intent = hashlib.sha256(json_bytes({"action": action, "payload": payload})).hexdigest()
        with self.mutex:
            old = self.db.execute("SELECT input_sha256,document FROM operations WHERE id=?", (request_id,)).fetchone()
            if old:
                require(old["input_sha256"] == intent, "LOCAL_OPERATION_CONFLICT", "Keep the same request ID with its original input.")
                operation = json.loads(old["document"])
                if operation["status"] == "COMPLETED":
                    return {"request_id": request_id, "revision": operation["revision"], "result": operation["result"]}
                if operation["status"] == "FAILED":
                    raise LeapError("LOCAL_SAVED_FAILURE", operation["error"]["message"], original_error=operation["error"], request_id=request_id)
                if action in REMOTE_ACTIONS or action in {"package.export", "workspace.restore"}:
                    return {"request_id": request_id, "revision": self.meta("revision"), "result": {"status": "INTERRUPTED", "operation": operation}}
            else:
                revision = self.meta("revision")
                require(expected_revision is None or (isinstance(expected_revision, int) and not isinstance(expected_revision, bool)
                        and expected_revision == revision), "LOCAL_REVISION", "Refresh the original workspace revision.", revision=revision)
                operation = {"id": request_id, "action": action, "status": "RUNNING", "input_sha256": intent,
                             "started_at": now_text(), "accepted_revision": revision}
                self.db.execute("INSERT INTO operations VALUES(?,?,?)", (request_id, intent, json_bytes(operation).decode()))
            external = action in REMOTE_ACTIONS or action in {"package.export", "workspace.restore"}
            if not external:
                self.db.execute("BEGIN IMMEDIATE")
            try:
                if action == "configuration.save":
                    result = self.configure(payload)
                elif action == "source.register":
                    result = self.register_source(payload)
                elif action == "mapping.save":
                    result = self.save_mapping(payload)
                elif action == "batch.prepare":
                    result = self.prepare(payload, request_id)
                elif action == "batch.submit":
                    result = self.submit(payload, request_id)
                elif action == "batch.refresh":
                    result = self.refresh(payload)
                elif action == "batch.reconcile":
                    result = self.reconcile(payload)
                elif action == "missing.refresh":
                    result = self.refresh_missing(payload, request_id)
                elif action == "package.export":
                    from leap_delivery import export_delivery
                    result = export_delivery(self, payload.get("batch_id"), request_id)
                elif action == "workspace.restore":
                    from leap_delivery import restore_workspace
                    result = restore_workspace(self, payload.get("file_id"))
                else:
                    raise LeapError("LOCAL_ACTION", "Unknown Leap workspace action.", action=action)
                if external:
                    self.db.execute("BEGIN IMMEDIATE")
                revision = self.meta("revision") + 1
                self.setmeta("revision", revision)
                operation.update(status="COMPLETED", completed_at=now_text(), revision=revision, result=result)
                self.db.execute("INSERT INTO operations(id,input_sha256,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document", (request_id, intent, json_bytes(operation).decode()))
                self.db.execute("COMMIT")
                return {"request_id": request_id, "revision": revision, "result": result}
            except BaseException as error:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                operation.update(status="FAILED", completed_at=now_text(), error=self.error_document(error))
                self.db.execute("UPDATE operations SET document=? WHERE id=?", (json_bytes(operation).decode(), request_id))
                raise

    def list_collection(self, collection, offset=0, limit=100):
        require(collection in COLLECTIONS, "LOCAL_COLLECTION", "Choose an original application collection.")
        offset, limit = self.page(offset, limit)
        total = self.db.execute("SELECT COUNT(*) FROM objects WHERE collection=?", (collection,)).fetchone()[0]
        rows = self.db.execute("SELECT document FROM objects WHERE collection=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
                               (collection, limit, offset))
        items = [self.summary(collection, json.loads(row[0])) for row in rows]
        return {"items": items, "total": total, "offset": offset, "limit": limit}

    @staticmethod
    def page(offset, limit):
        try:
            offset, limit = int(offset), int(limit)
        except (ValueError, TypeError) as error:
            raise LeapError("LOCAL_PAGE", "Use integer page offsets and lengths.") from error
        require(offset >= 0 and 1 <= limit <= 500, "LOCAL_PAGE", "Use a nonnegative offset and 1–500 rows per page.")
        return offset, limit

    @staticmethod
    def summary(collection, document):
        if collection == "batches":
            fields = ("id", "name", "status", "source_ids", "mapping_id", "row_count", "issue_count", "provider_error_count",
                      "meter_count", "created_at", "clock_utc", "upload", "job_id", "correction_of", "missing_snapshot_id")
            return {key: document[key] for key in fields if key in document}
        if collection == "mappings":
            return {key: document[key] for key in ("id", "name", "environment", "partner_account_id", "reviewer", "created_at")}
        return document

    def state(self):
        collections = ("imports", "mappings", "batches", "missing_snapshots")
        result = {"schema": SCHEMA, "workspace_id": self.meta("workspace_id"), "revision": self.meta("revision"),
                  "config": self.meta("config"), "counts": {}, "provider_not_before": self.meta("provider_not_before")}
        for collection in collections:
            page = self.list_collection(collection, 0, 100)
            result[collection] = page["items"]
            result["counts"][collection] = page["total"]
        return result

    def rows(self, batch_id, offset=0, limit=100):
        self.get("batches", sha_value(batch_id, "Original batch"))
        offset, limit = self.page(offset, limit)
        total = self.db.execute("SELECT COUNT(*) FROM batch_rows WHERE batch_id=?", (batch_id,)).fetchone()[0]
        values = self.db.execute("SELECT document FROM batch_rows WHERE batch_id=? ORDER BY row_index LIMIT ? OFFSET ?",
                                 (batch_id, limit, offset))
        return {"items": [json.loads(row[0]) for row in values], "total": total, "offset": offset, "limit": limit}

    def issue_rows(self, batch_id, offset=0, limit=100):
        batch = self.get("batches", sha_value(batch_id, "Original batch"))
        offset, limit = self.page(offset, limit)
        local = self.db.execute("SELECT COUNT(*) FROM issues WHERE batch_id=?", (batch_id,)).fetchone()[0]
        remote = self.db.execute("SELECT COUNT(*) FROM job_errors WHERE job_id=?", (batch.get("job_id", ""),)).fetchone()[0]
        items = []
        if offset < local:
            rows = self.db.execute("SELECT document FROM issues WHERE batch_id=? ORDER BY id LIMIT ? OFFSET ?",
                                   (batch_id, min(limit, local - offset), offset))
            items.extend(json.loads(row[0]) for row in rows)
        remaining = limit - len(items)
        if remaining and remote:
            rows = self.db.execute("SELECT document FROM job_errors WHERE job_id=? ORDER BY row_index LIMIT ? OFFSET ?",
                                   (batch["job_id"], remaining, max(0, offset - local)))
            for saved in rows:
                original = json.loads(saved[0])
                items.append({"row_index": None, "provider_line": original.get("line"), "provider_job_id": batch["job_id"], **original})
        return {"items": items, "total": local + remote, "offset": offset, "limit": limit}

    def missing_rows_page(self, snapshot_id, offset=0, limit=100):
        self.get("missing_snapshots", sha_value(snapshot_id, "Original missing-window snapshot"))
        offset, limit = self.page(offset, limit)
        total = self.db.execute("SELECT COUNT(*) FROM missing_rows WHERE snapshot_id=?", (snapshot_id,)).fetchone()[0]
        rows = self.db.execute("SELECT row_index,document FROM missing_rows WHERE snapshot_id=? ORDER BY row_index LIMIT ? OFFSET ?",
                               (snapshot_id, limit, offset))
        return {"items": [{"row_index": row["row_index"], **json.loads(row["document"])} for row in rows],
                "total": total, "offset": offset, "limit": limit}
