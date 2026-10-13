"""Approved World Bank handover intake on the original running Analysis owner.

Chunked intake retains exact bytes and stable requests; the original
WorldBankAnalysis source importer and typed projection validate the document.
Registration does not select a view or run a report/workbook.
"""
from __future__ import annotations

import base64
import binascii
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import threading

from .errors import StateError
from .storage import private_directory
from .response_documents import document_path, validate_manifest, _delivery
from .worldbank_analysis import WorldBankAnalysis, encoded, regular, write, sha, MAX_PACKAGE

SCHEMA = "stellar-forge.worldbank-intake.v1"
CHUNK_BYTES = 256 * 1024
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")


def need(condition, code):
    if not condition:
        raise StateError("WORLDBANK_INTAKE_" + code)


def identifier(value):
    need(isinstance(value, str) and _ID.fullmatch(value), "ID_REQUIRED")
    return value


def now():
    return datetime.now(timezone.utc).isoformat()


class _Registration(WorldBankAnalysis):
    """Override only the original post-projection registration hook."""

    def _prepare_analysis(self, workspace, document, name, source, review,
                          rows, columns, selected_recipes, max_rows, *, resume):
        # Use the complete operation ID; the browser cannot choose an existing
        # source name or overwrite a customer's source revision.
        name = "worldbank_intake_" + self.operation_id
        manifest = document / "source.json"
        expected_document = sha(regular(manifest))
        with workspace.database._connection(readonly=True) as db:
            existing = db.execute("SELECT record FROM sf_analysis_sources WHERE name=?", (name,)).fetchone()
        if existing:
            registered = json.loads(existing[0])
            need(registered.get("input_kind") == "document" and
                 registered.get("document_id") == expected_document, "REGISTERED_SOURCE_CHANGED")
            # Reopen the retained original source; existence alone is insufficient.
            with workspace.responses._open(registered).file.open():
                pass
        else:
            registered = workspace.responses.register(name, "document", manifest=manifest, expected_revision=0)
        value = {
            "schema": SCHEMA, "id": self.operation_id, "status": "REGISTERED",
            "workspace_id": workspace.identity,
            "source": {"name": registered["name"], "revision": registered["revision"],
                       "document_id": registered["document_id"]},
            "handover": self.record["source"]["handover"],
            "observations": len(rows), "columns": columns,
            "source_metadata": source, "original_review": review,
            "registered_at": now(),
        }
        # This is separate from WorldBankAnalysis.result's complete delivery contract.
        path = self.directory / "intake-registration.json"
        if path.exists():
            retained = json.loads(regular(path))
            need(all(retained.get(key) == value[key] for key in
                     ("schema", "id", "status", "workspace_id", "source", "handover",
                      "observations", "columns", "source_metadata", "original_review")),
                 "REGISTRATION_CHANGED")
            return retained
        write(path, encoded(value), exact=True)
        return value


class WorldBankIntake:
    def __init__(self, workspace, *, core):
        self.workspace = workspace
        self.database = workspace.database
        self.core = Path(core).expanduser().resolve(strict=True)
        need(self.core.name == "core.py", "ORIGINAL_INSTALLED_CORE_REQUIRED")
        self.directory = private_directory(self.database.directory / "worldbank-intake", create=True)
        self._mutex = threading.RLock()
        self._closed = False
        self._active = None
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_worldbank_intakes("
                       "sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,record TEXT NOT NULL)")
            for row in db.execute("SELECT id,record FROM sf_worldbank_intakes").fetchall():
                value = json.loads(row["record"])
                if value["status"] == "REGISTERING":
                    value.update(status="INTERRUPTED", error="Continue the same approved handover registration.",
                                 updated_at=now())
                    db.execute("UPDATE sf_worldbank_intakes SET record=? WHERE id=?",
                               (encoded(value).decode(), row["id"]))
            db.commit()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="worldbank-intake")

    def close(self):
        with self._mutex:
            self._closed = True
        # Drain before the owning AnalysisWorkspace closes its jobs and sources.
        self._executor.shutdown(wait=True)

    def _load(self, intake_id):
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT record FROM sf_worldbank_intakes WHERE id=?",
                             (identifier(intake_id),)).fetchone()
        need(row is not None, "NOT_FOUND")
        return json.loads(row[0])

    def _store(self, value):
        value["updated_at"] = now()
        with self.database._connection() as db:
            db.execute("UPDATE sf_worldbank_intakes SET record=? WHERE id=?",
                       (encoded(value).decode(), value["id"]))

    def _root(self, intake_id):
        return private_directory(self.directory / identifier(intake_id), create=True)

    def _retained_original(self, value):
        need(value["status"] == "REGISTERED", "REGISTERED_SOURCE_REQUIRED")
        selected = value["result"]["source"]
        with self.database._connection(readonly=True) as db:
            source = self.workspace.responses._source(db, selected["name"], selected["revision"])
        need(source.get("document_id") == selected["document_id"], "REGISTERED_SOURCE_CHANGED")
        manifest_path = document_path(self.database.directory, source["document_id"])
        raw = regular(manifest_path, 1024 * 1024)
        need(sha(raw) == selected["document_id"], "DOCUMENT_CHANGED")
        manifest = validate_manifest(json.loads(raw))
        original = next((item for item in manifest["originals"]
                         if item["role"] == "original-worldbank-handover"), None)
        need(original is not None and original["bytes"] == value["intent"]["bytes"]
             and original["sha256"] == value["intent"]["sha256"], "ORIGINAL_CHANGED")
        return _delivery(manifest_path.parent, original), original

    def status(self, intake_id):
        value = self._load(intake_id)
        # A portable Analysis archive carries registered documents and this SQL
        # history. Upload fragments are local staging and may need the same file
        # after an interrupted workspace is restored into another installation.
        if value["status"] != "REGISTERED":
            root = self._root(intake_id)
            available = 0
            for chunk in value["chunks"]:
                path = root / ("chunk-" + str(chunk["offset"]).zfill(12))
                if not path.exists():
                    break
                body = regular(path, CHUNK_BYTES)
                need(len(body) == chunk["bytes"] and sha(body) == chunk["sha256"],
                     "RETAINED_CHUNK_CHANGED")
                available += len(body)
            value["available_bytes"] = available
            value["needs_original_file"] = available < value["intent"]["bytes"]
        else:
            delivery, _ = self._retained_original(value)
            with delivery.open():
                pass
            value["available_bytes"] = value["intent"]["bytes"]
            value["needs_original_file"] = False
        return {**value, "chunk_bytes": CHUNK_BYTES, "workspace_id": self.workspace.identity}

    def history(self, *, before=None, limit=25):
        need(type(limit) is int and 1 <= limit <= 100 and
             (before is None or type(before) is int and before > 0), "PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,record FROM sf_worldbank_intakes "
                "WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                (before, before, limit + 1)).fetchall()
        return {"schema": SCHEMA, "workspace_id": self.workspace.identity,
                "intakes": [json.loads(row["record"]) for row in rows[:limit]],
                "next_before": rows[limit-1]["sequence"] if len(rows) > limit else None,
                "chunk_bytes": CHUNK_BYTES, "max_bytes": MAX_PACKAGE}

    def begin(self, request):
        intake_id = identifier(request.get("id"))
        size, digest = request.get("bytes"), request.get("sha256")
        filename = request.get("filename")
        need(type(size) is int and 0 < size <= MAX_PACKAGE, "HANDOVER_SIZE_INVALID")
        need(isinstance(digest, str) and _HASH.fullmatch(digest), "HANDOVER_HASH_REQUIRED")
        need(isinstance(filename, str) and filename and len(filename.encode()) <= 240
             and "/" not in filename and "\\" not in filename
             and all(ord(c) >= 32 and ord(c) != 127 for c in filename), "FILENAME_INVALID")
        intent = {"bytes": size, "sha256": digest, "filename": filename}
        with self._mutex:
            need(not self._closed, "CLOSED")
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT record FROM sf_worldbank_intakes WHERE id=?", (intake_id,)).fetchone()
                if old:
                    value = json.loads(old[0])
                    need(value["intent"] == intent, "ID_REUSED")
                else:
                    # Intake IDs share the original World Bank operation namespace.
                    need(not (self.database.directory / "worldbank-analysis" / intake_id).exists(),
                         "OPERATION_ID_ALREADY_USED")
                    value = {"schema": SCHEMA, "id": intake_id, "intent": intent,
                             "status": "UPLOADING", "received_bytes": 0, "chunks": [],
                             "attempts": [], "created_at": now(), "updated_at": now()}
                    db.execute("INSERT INTO sf_worldbank_intakes(id,record) VALUES(?,?)",
                               (intake_id, encoded(value).decode()))
                db.commit()
        return self.status(intake_id)

    def chunk(self, intake_id, request):
        need(isinstance(request.get("content"), str) and len(request["content"]) <=
             ((CHUNK_BYTES + 2) // 3) * 4, "CHUNK_SIZE_INVALID")
        try:
            body = base64.b64decode(request["content"], validate=True)
        except (ValueError, binascii.Error):
            raise StateError("WORLDBANK_INTAKE_CHUNK_BASE64_INVALID") from None
        offset, digest = request.get("offset"), request.get("sha256")
        need(type(offset) is int and offset >= 0 and body and len(body) <= CHUNK_BYTES
             and digest == sha(body), "CHUNK_IDENTITY_INVALID")
        with self._mutex:
            need(not self._closed, "CLOSED")
            value = self._load(intake_id)
            need(value["status"] not in {"REGISTERED", "REGISTERING"}, "UPLOAD_ALREADY_FINISHED")
            need(offset % CHUNK_BYTES == 0 and offset + len(body) <= value["intent"]["bytes"]
                 and (len(body) == CHUNK_BYTES or offset + len(body) == value["intent"]["bytes"]),
                 "CHUNK_POSITION_INVALID")
            record = {"offset": offset, "bytes": len(body), "sha256": digest}
            old = next((x for x in value["chunks"] if x["offset"] == offset), None)
            if old is not None:
                need(old == record, "CHUNK_ID_REUSED")
            else:
                need(offset == value["received_bytes"], "CONTIGUOUS_CHUNK_REQUIRED")
            # Atomic immutable members make a write-before-SQL interruption safe.
            write(self._root(intake_id) / ("chunk-" + str(offset).zfill(12)), body, exact=True)
            if old is None:
                value["chunks"].append(record)
                value["received_bytes"] += len(body)
            value.update(status="UPLOADED" if value["received_bytes"] == value["intent"]["bytes"]
                         else "UPLOADING", error=None)
            self._store(value)
        return {"id": intake_id, "status": value["status"], "received_bytes": value["received_bytes"]}

    def register(self, intake_id, *, resume=False):
        need(type(resume) is bool, "RESUME_INVALID")
        with self._mutex:
            need(not self._closed, "CLOSED")
            value = self._load(intake_id)
            if value["status"] in {"REGISTERED", "REGISTERING"}:
                return self.status(intake_id)
            need(self._active is None, "BUSY")
            need(value["status"] in {"UPLOADED", "ERROR", "INTERRUPTED"}
                 and value["received_bytes"] == value["intent"]["bytes"], "COMPLETE_UPLOAD_REQUIRED")
            need(value["status"] == "UPLOADED" or resume, "EXPLICIT_CONTINUATION_REQUIRED")
            body = bytearray()
            for chunk in value["chunks"]:
                part = regular(self._root(intake_id) / ("chunk-" + str(chunk["offset"]).zfill(12)), CHUNK_BYTES)
                need(len(body) == chunk["offset"] and len(part) == chunk["bytes"]
                     and sha(part) == chunk["sha256"], "RETAINED_CHUNK_CHANGED")
                body.extend(part)
            need(len(body) == value["intent"]["bytes"] and sha(body) == value["intent"]["sha256"],
                 "FULL_HANDOVER_CHANGED")
            handover = self._root(intake_id) / "handover.zip"
            write(handover, bytes(body), exact=True)
            value.update(status="REGISTERING", error=None)
            value["attempts"].append({"started_at": now(), "status": "REGISTERING"})
            self._store(value)
            self._active = intake_id
            self._executor.submit(self._run, intake_id, handover)
            return value

    def _run(self, intake_id, handover):
        try:
            def progress(event):
                with self._mutex:
                    value = self._load(intake_id)
                    value["progress"] = event
                    self._store(value)
            # The shared source adapter's active_workspace hook uses the SAME
            # native owner, avoiding another process lease or replacement engine.
            current = _Registration(self.database.directory, operation_id=intake_id,
                                    active_workspace=self.workspace, progress=progress)
            result = current.prepare(handover, self.core, prefix="intake", resume=True)
            need(result.get("status") == "REGISTERED", "SOURCE_REGISTRATION_REQUIRED")
            with self._mutex:
                value = self._load(intake_id)
                value.update(status="REGISTERED", result=result, error=None)
                value["attempts"][-1].update(status="REGISTERED", finished_at=now())
                self._store(value)
        except Exception as error:
            with self._mutex:
                value = self._load(intake_id)
                value.update(status="ERROR", error=str(error))
                value["attempts"][-1].update(status="ERROR", error=str(error), finished_at=now())
                self._store(value)
        finally:
            with self._mutex:
                self._active = None

    def original(self, intake_id):
        value = self._load(intake_id)
        delivery, original = self._retained_original(value)
        # Callers use the original descriptor-based delivery.open()/send_export.
        return delivery, {"name": "WorldBank_Approved_Handover.zip",
                          "filename": "WorldBank_Approved_Handover.zip",
                          "mime": "application/zip", "bytes": original["bytes"],
                          "sha256": original["sha256"]}
