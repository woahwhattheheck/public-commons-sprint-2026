"""A local customer workspace on the original dataset application and database.

Run ``python -m stellar_forge_buyer.analysis_workspace --help``. This module
does not call acquisition.run(), recovery, financial finalization or a signer.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import hashlib
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import threading
from urllib.parse import parse_qs, urlsplit
import uuid
import webbrowser

from . import _analysis_ui
from .datasets import DatasetAcquisition
from .dataset_changes import DatasetChanges
from .analysis_reports import AnalysisReports
from .analysis_exports import AnalysisExports
from ._analysis_export_http import send_export
from .response_tables import AnalysisResponses
from .errors import BuyerError, StateError
from .sqlite_dataset import DatasetDatabase
from .storage import digest, dump, parse, private_directory, read

_SCHEMA = "stellar-forge.customer-analysis.v1"
_NAME = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}")
_JOB = re.compile(r"[a-f0-9]{32}")
_MAX_BODY = 1024 * 1024
_MAX_DOWNLOAD = 256 * 1024 * 1024


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _name(value):
    if not isinstance(value, str) or not _NAME.fullmatch(value):
        raise StateError("ANALYSIS_NAME_INVALID")
    return value


def _parameters(value):
    if not isinstance(value, str) or len(value.encode()) > 256 * 1024:
        raise StateError("ANALYSIS_PARAMETERS_INVALID")
    parsed = parse(value.encode())
    if not isinstance(parsed, (dict, list)):
        raise StateError("ANALYSIS_PARAMETERS_ARRAY_OR_OBJECT_REQUIRED")
    values = parsed.values() if isinstance(parsed, dict) else parsed
    if any(item is not None and (type(item) not in (str, int, float, bool)
            or type(item) is int and not -(2**63) <= item < 2**63
            or type(item) is float and not math.isfinite(item)) for item in values):
        raise StateError("ANALYSIS_SQL_SCALAR_PARAMETERS_REQUIRED")
    return parsed


def _query(value):
    if not isinstance(value, dict):
        raise StateError("ANALYSIS_QUERY_REQUIRED")
    sql = value.get("sql")
    if not isinstance(sql, str) or not sql.strip() or len(sql.encode()) > 128 * 1024:
        raise StateError("ANALYSIS_SQL_REQUIRED")
    text = value.get("parameters_text", "[]")
    _parameters(text)
    limit = value.get("max_rows", 1000)
    if type(limit) is not int or not 1 <= limit <= 100_000:
        raise StateError("ANALYSIS_ROW_LIMIT_INVALID")
    return {"sql": sql, "parameters_text": text, "max_rows": limit}


def _cell(value):
    # JavaScript must not round SQLite's exact signed 64-bit integers.
    if value is None:
        return {"type": "null", "text": ""}
    if isinstance(value, bytes):
        return {"type": "blob", "text": base64.b64encode(value).decode("ascii")}
    if type(value) is float and not math.isfinite(value):
        return {"type": "sqlite-real", "text": str(value)}
    return {"type": "integer" if type(value) is int else "number" if type(value) is float else "string", "text": str(value)}


def _value(cell):
    kind, text = cell["type"], cell["text"]
    if kind == "null":
        return None
    if kind == "integer":
        return int(text)
    if kind == "number":
        return float(text)
    if kind == "blob":
        return {"encoding": "base64", "value": text}
    if kind == "sqlite-real":
        return {"encoding": "sqlite-real", "value": text}
    return text


class AnalysisWorkspace:
    """Durable query recipes/results beside the original immutable row tables.

    One workspace process owns background jobs. Other DatasetDatabase clients
    remain supported; original SQLite transactions and view revisions arbitrate
    their imports and activations. Source registration is an operator action.
    """

    def __init__(self, directory, *, checkout=None, node="node"):
        self.database = DatasetDatabase(directory)
        self.checkout = str(Path(checkout).expanduser().resolve()) if checkout else None
        self.node = node
        self._mutex = threading.Lock()
        self._closed = False
        self._owner = os.open(self.database.directory / "analysis.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(self._owner)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
                raise StateError("ANALYSIS_PRIVATE_LOCK_REQUIRED")
            fcntl.flock(self._owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self._owner)
            raise StateError("ANALYSIS_WORKSPACE_ALREADY_OPEN") from None
        try:
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_format(id INTEGER PRIMARY KEY CHECK(id=1),schema TEXT NOT NULL,workspace_id TEXT NOT NULL)")
                row = db.execute("SELECT * FROM sf_analysis_format WHERE id=1").fetchone()
                if row is None:
                    db.execute("INSERT INTO sf_analysis_format VALUES(1,?,?)", (_SCHEMA, uuid.uuid4().hex))
                elif row["schema"] != _SCHEMA:
                    raise StateError("ANALYSIS_FORMAT_MISMATCH")
                self.identity = db.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1").fetchone()[0]
                db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_sources(name TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_queries(name TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_query_history(sequence INTEGER PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,UNIQUE(name,revision))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_jobs(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,request TEXT NOT NULL,result TEXT,error TEXT)")
                # No automatic replay. Original imports are idempotent when the
                # operator explicitly retries after an interrupted process.
                db.execute("UPDATE sf_analysis_jobs SET status='INTERRUPTED',finished_at=?,error='WORKSPACE_PROCESS_INTERRUPTED' WHERE status='RUNNING'", (_now(),))
                db.commit()
            self.changes = DatasetChanges(self.database)
            self.reports = AnalysisReports(self.database, encode_cell=_cell, parse_parameters=_parameters, changes=self.changes)
            self.responses = AnalysisResponses(self.database, checkout=self.checkout, node=self.node, encode_cell=_cell)
            self.exports = AnalysisExports(self.database, identity=self.identity, read_job=self._job, parse_parameters=_parameters)
            self.exports.recover_completed()
            self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset-analysis")
        except BaseException:
            os.close(self._owner)
            raise

    def close(self):
        with self._mutex:
            if self._closed:
                return
            self._closed = True
        self.exports.close()
        self._executor.shutdown(wait=True)
        os.close(self._owner)

    def _acquisition(self, source):
        if self.checkout is None:
            raise StateError("ANALYSIS_ORIGINAL_RUNTIME_CHECKOUT_REQUIRED")
        return DatasetAcquisition(checkout=self.checkout, session=source["session"], node=self.node)

    def register_source(self, name, session, *, room=None, expected_revision=0, expected_native=None):
        """Declare a native session locally; the browser never supplies paths."""
        name = _name(name)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("ANALYSIS_SOURCE_REVISION_REQUIRED")
        session = private_directory(Path(session), create=False)
        room = Path(room).expanduser().absolute() if room else self.database.directory / "analysis-rooms" / name
        room = Path(os.path.abspath(room))
        source = {"name": name, "session": str(session), "room": str(room)}
        report = self._acquisition(source).inspect()
        if not report.get("configurationSha256") or not report.get("sessionId"):
            raise StateError("ANALYSIS_ORIGINAL_SESSION_NOT_READY")
        source.update(session_sha256=digest(read(session / "session.json", 4 * 1024 * 1024)),
                      configuration_sha256=report["configurationSha256"], session_id=report["sessionId"],
                      native_status=report["status"], rows=report.get("acquiredRows"),
                      snapshot=report.get("snapshot"), registered_at=_now())
        if expected_native is not None:
            from .analysis_native import verify_dataset_source
            verify_dataset_source(self, source, report, expected_native)
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM sf_analysis_sources WHERE name=?", (name,)).fetchone()
            if existing:
                old = parse(existing["record"].encode())
                if all(old.get(key) == source[key] for key in ("session", "room", "session_sha256")):
                    db.commit()
                    if expected_native is not None:
                        return {**old, "native_delivery": source["native_delivery"]}
                    return old
            revision = existing["revision"] if existing else 0
            if revision != expected_revision:
                raise StateError("ANALYSIS_SOURCE_CHANGED")
            source["revision"] = revision + 1
            db.execute("INSERT INTO sf_analysis_sources VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record", (name, source["revision"], _json(source)))
            db.commit()
        return source

    def state(self):
        return self._state(self.database, self.identity, self.checkout is not None)

    @staticmethod
    def read_state(directory):
        """Read saved state while its original workspace process is running."""
        database = DatasetDatabase(directory, create=False)
        with database._connection(readonly=True) as db:
            try:
                identity = db.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1 AND schema=?", (_SCHEMA,)).fetchone()
            except sqlite3.Error:
                raise StateError("ANALYSIS_WORKSPACE_NOT_INITIALIZED") from None
            if identity is None:
                raise StateError("ANALYSIS_FORMAT_MISMATCH")
        return AnalysisWorkspace._state(database, identity[0], False)

    @staticmethod
    def _state(database, identity, can_import):
        with database._connection(readonly=True) as db:
            db.execute("BEGIN")
            sources = [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_analysis_sources ORDER BY name")]
            queries = [dict(row) for row in db.execute("SELECT name,revision FROM sf_analysis_queries ORDER BY name")]
            jobs = [dict(row) for row in db.execute("SELECT sequence,id,kind,status,created_at,finished_at,error FROM sf_analysis_jobs ORDER BY sequence DESC LIMIT 30")]
            views = database._views(db)
            reports = AnalysisReports.state(db)
        return {"schema": _SCHEMA, "workspace_id": identity, "database": str(database.path),
                "can_import": can_import, "sources": sources, "queries": queries, "views": views, "jobs": jobs, "reports": reports}

    def save_query(self, name, value, *, expected_revision):
        name, spec = _name(name), _query(value)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("ANALYSIS_QUERY_REVISION_REQUIRED")
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision FROM sf_analysis_queries WHERE name=?", (name,)).fetchone()
            revision = row[0] if row else 0
            if revision != expected_revision:
                raise StateError("ANALYSIS_SAVED_QUERY_CHANGED")
            record = {**spec, "name": name, "revision": revision + 1, "saved_at": _now()}
            raw = _json(record)
            db.execute("INSERT INTO sf_analysis_queries VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record", (name, revision + 1, raw))
            db.execute("INSERT INTO sf_analysis_query_history(name,revision,record) VALUES(?,?,?)", (name, revision + 1, raw))
            db.commit()
        return record

    def saved_query(self, name, *, revision=None):
        name = _name(name)
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            if revision is None:
                row = db.execute("SELECT record FROM sf_analysis_queries WHERE name=?", (name,)).fetchone()
            else:
                row = db.execute("SELECT record FROM sf_analysis_query_history WHERE name=? AND revision=?", (name, revision)).fetchone()
            if row is None:
                raise StateError("ANALYSIS_QUERY_NOT_FOUND")
            record = parse(row[0].encode())
            record["head_revision"] = db.execute("SELECT revision FROM sf_analysis_queries WHERE name=?", (name,)).fetchone()[0]
            record["history"] = [dict(r) for r in db.execute("SELECT revision FROM sf_analysis_query_history WHERE name=? ORDER BY revision DESC LIMIT 100", (name,))]
            return record

    def start(self, kind, request):
        """Persist the exact request before dispatch; repeated IDs reuse it."""
        if kind not in {"import", "query", "query-export", "backup", "compare", "change-export", "report", "report-export", "response-preview", "response-import"} or not isinstance(request, dict):
            raise StateError("ANALYSIS_JOB_INVALID")
        job_id = request.get("id")
        if not isinstance(job_id, str) or not _JOB.fullmatch(job_id):
            raise StateError("ANALYSIS_REQUEST_ID_REQUIRED")
        spec = {"id": job_id}
        if kind in {"response-preview", "response-import"}:
            spec.update(self.responses.prepare(kind, request))
        elif kind == "query":
            spec.update(_query(request))
            if not isinstance(request.get("expected_views"), list):
                raise StateError("ANALYSIS_REVIEWED_VIEWS_REQUIRED")
            spec["expected_views"] = request["expected_views"]
        elif kind == "query-export":
            spec.update(self.exports.prepare(request))
        elif kind == "report":
            spec.update(self.reports.prepare(request))
        elif kind == "report-export":
            spec.update(self.reports.prepare_export(request))
        elif kind == "compare":
            spec.update(self.changes.prepare(request, check=False))
        elif kind == "change-export":
            spec.update(self.changes.prepare_export(request, check=False))
        elif kind == "import":
            name = _name(request.get("source"))
            mapping = parse(request.get("columns_text", "{}").encode())
            if not isinstance(mapping, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()):
                raise StateError("ANALYSIS_COLUMN_MAPPING_INVALID")
            with self.database._connection(readonly=True) as db:
                row = db.execute("SELECT record FROM sf_analysis_sources WHERE name=?", (name,)).fetchone()
            if row is None:
                raise StateError("ANALYSIS_SOURCE_NOT_FOUND")
            source = parse(row[0].encode())
            if source.get("kind") == "response":
                raise StateError("ANALYSIS_USE_RESPONSE_MAPPING_WORKFLOW")
            if request.get("source_revision") != source["revision"]:
                raise StateError("ANALYSIS_SOURCE_CHANGED")
            spec.update(source=source, columns=mapping)
        raw = _json(spec)
        with self._mutex:
            if self._closed:
                raise StateError("ANALYSIS_WORKSPACE_CLOSED")
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT kind,request FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
                if old:
                    if old["kind"] != kind or old["request"] != raw:
                        raise StateError("ANALYSIS_REQUEST_ID_REUSED")
                    db.commit()
                    return self.job(job_id)
                if db.execute("SELECT 1 FROM sf_analysis_jobs WHERE status='RUNNING' LIMIT 1").fetchone():
                    raise StateError("ANALYSIS_JOB_RUNNING")
                if kind in {"response-preview", "response-import"}:
                    self.responses.validate(db, kind, spec)
                elif kind == "compare":
                    self.changes._inputs(db, spec)
                elif kind == "change-export":
                    self.changes._export_input(db, spec)
                elif kind == "report":
                    self.reports._input(db, spec)
                elif kind == "report-export":
                    self.reports._export_input(db, spec)
                db.execute("INSERT INTO sf_analysis_jobs(id,kind,status,created_at,request) VALUES(?,?,'RUNNING',?,?)", (job_id, kind, _now(), raw))
                db.commit()
            self._executor.submit(self._execute, job_id, kind, spec)
        return self.job(job_id)

    def _execute(self, job_id, kind, spec):
        try:
            if kind == "query-export":
                self.exports.run(job_id, spec)
                return
            if kind in {"response-preview", "response-import"}:
                result = self.responses.execute(kind, spec)
            elif kind == "import":
                source = spec["source"]
                path = Path(source["session"]) / "session.json"
                if digest(read(path, 4 * 1024 * 1024)) != source["session_sha256"]:
                    raise StateError("ANALYSIS_REGISTERED_SESSION_CHANGED")
                acquisition = self._acquisition(source)
                status = acquisition.inspect()
                if status.get("status") != "COMPLETE":
                    raise StateError("ANALYSIS_COMPLETED_ACQUISITION_REQUIRED")
                delivery = acquisition.deliver(source["room"])
                if digest(read(path, 4 * 1024 * 1024)) != source["session_sha256"]:
                    raise StateError("ANALYSIS_REGISTERED_SESSION_CHANGED")
                result = self.database.import_delivery(delivery, columns=spec["columns"])
                result = {"version": result, "source": source["name"], "source_revision": source["revision"],
                          "native_delivery": {"status": delivery.status, "appended_pages": delivery.native.get("appendedPages"), "payment_status": delivery.payment_status}}
            elif kind == "query":
                with self.database._connection(readonly=True) as db:
                    db.execute("BEGIN")
                    result = self.database._query(db, spec["sql"], _parameters(spec["parameters_text"]), max_rows=spec["max_rows"],
                        max_result_bytes=4 * 1024 * 1024, timeout=20, expected_views=spec["expected_views"])
                    sources = []
                    for table in result.read_tables:
                        if table.startswith("sf_dataset_rows_") and re.fullmatch(r"[a-f0-9]{64}", table[16:]):
                            version = self.database._version(db, table[16:])
                            sources.append({key: value for key, value in version.items()
                                            if key not in {"sourceDirectory", "sequence", "created_at"}})
                result = {"columns": list(result.columns), "rows": [[_cell(v) for v in row] for row in result.rows],
                          "truncated": result.truncated, "views": list(result.views), "read_tables": list(result.read_tables),
                          "source_versions": sources}
                result["result_sha256"] = digest(_json(result).encode())
            elif kind == "compare":
                # Difference rows and the COMPLETE job become visible together.
                self.changes.run(job_id, spec)
                return
            elif kind == "change-export":
                result = self.changes.export({key: value for key, value in spec.items() if key != "id"})
            elif kind == "report":
                self.reports.run(job_id, {key: value for key, value in spec.items() if key != "id"})
                return
            elif kind == "report-export":
                result = self.reports.export({key: value for key, value in spec.items() if key != "id"})
            else:
                target = self.database.backup(self.database.directory / "analysis-backups" / job_id)
                with target.open("rb") as stream:
                    sha = hashlib.file_digest(stream, "sha256").hexdigest()
                result = {"path": str(target), "bytes": target.stat().st_size, "sha256": sha, "downloadable": target.stat().st_size <= _MAX_DOWNLOAD}
            raw = _json(result)
            with self.database._connection() as db:
                db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,finished_at=? WHERE id=? AND status='RUNNING'", (raw, _now(), job_id))
        except BaseException as exc:
            code = getattr(exc, "code", None) or str(exc) if isinstance(exc, BuyerError) else type(exc).__name__
            if isinstance(exc.__cause__, sqlite3.Error):
                code += ": " + str(exc.__cause__)
            with self.database._connection() as db:
                db.execute("UPDATE sf_analysis_jobs SET status='FAILED',error=?,finished_at=? WHERE id=? AND status='RUNNING'", (str(code)[:256], _now(), job_id))

    def _job(self, job_id):
        if not isinstance(job_id, str) or not _JOB.fullmatch(job_id):
            raise StateError("ANALYSIS_JOB_ID_INVALID")
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT * FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise StateError("ANALYSIS_JOB_NOT_FOUND")
        job = dict(row)
        job["request"] = parse(job["request"].encode())
        job["result"] = parse(job["result"].encode()) if job["result"] is not None else None
        if job["kind"] == "query" and job["result"] is not None:
            result = job["result"]
            if result.get("result_sha256") != digest(_json({k: v for k, v in result.items() if k != "result_sha256"}).encode()):
                raise StateError("ANALYSIS_RETAINED_RESULT_CHANGED")
        elif job["kind"] == "compare" and job["result"] is not None:
            with self.database._connection(readonly=True) as db:
                job["result"] = self.changes._report(db, job_id)
        elif job["kind"] == "report" and job["result"] is not None:
            with self.database._connection(readonly=True) as db:
                job["result"] = self.reports._report(db, job_id)
        elif job["kind"] == "query-export":
            job["progress"] = self.exports.progress(job_id)
        return job

    def job(self, job_id, *, offset=0, limit=100):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise StateError("ANALYSIS_RESULT_PAGE_INVALID")
        job = self._job(job_id)
        if job["kind"] == "query" and job["result"] is not None:
            result = job["result"]
            rows = result["rows"]
            result.update(rows=rows[offset:offset + limit], total_rows=len(rows), offset=offset,
                          next_offset=offset + limit if offset + limit < len(rows) else None)
        return job

    def export_result(self, job_id, format):
        job = self._job(job_id)
        if job["kind"] != "query" or job["status"] != "COMPLETE":
            raise StateError("ANALYSIS_COMPLETE_QUERY_REQUIRED")
        result = job["result"]
        if format == "json":
            data = {"schema": _SCHEMA, "id": job_id, "executed_at": job["finished_at"], "request": job["request"],
                    "columns": result["columns"], "rows": [[_value(v) for v in row] for row in result["rows"]],
                    "truncated": result["truncated"], "views": result["views"], "read_tables": result["read_tables"],
                    "result_sha256": result["result_sha256"],
                    "source_versions": result.get("source_versions", [])}
            return (_json(data) + "\n").encode(), "application/json", "analysis-" + job_id + ".json"
        if format != "csv":
            raise StateError("ANALYSIS_EXPORT_FORMAT_INVALID")
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(result["columns"])
        for row in result["rows"]:
            writer.writerow([v["text"] if v["type"] != "null" else "" for v in row])
        return stream.getvalue().encode(), "text/csv;charset=utf-8", "analysis-" + job_id + ".csv"

    def backup_file(self, job_id):
        job = self._job(job_id)
        if job["kind"] != "backup" or job["status"] != "COMPLETE":
            raise StateError("ANALYSIS_COMPLETE_BACKUP_REQUIRED")
        path = self.database.directory / "analysis-backups" / job_id / "datasets.sqlite3"
        if str(path) != job["result"]["path"]:
            raise StateError("ANALYSIS_BACKUP_LOCATION_CHANGED")
        return path

    def change_export_file(self, job_id):
        job = self._job(job_id)
        if job["kind"] != "change-export" or job["status"] != "COMPLETE":
            raise StateError("ANALYSIS_COMPLETE_CHANGE_EXPORT_REQUIRED")
        result = job["result"]
        if not re.fullmatch(r"changes-[a-f0-9]{64}\.(json|csv)", result["filename"]):
            raise StateError("ANALYSIS_CHANGE_EXPORT_LOCATION_CHANGED")
        path = self.database.directory / "analysis-exports" / result["filename"]
        if str(path) != result["path"]:
            raise StateError("ANALYSIS_CHANGE_EXPORT_REGENERATE_AFTER_RECOVERY")
        return path, result

    def report_export_file(self, job_id):
        job = self._job(job_id)
        if job["kind"] != "report-export" or job["status"] != "COMPLETE":
            raise StateError("ANALYSIS_COMPLETE_REPORT_EXPORT_REQUIRED")
        result = job["result"]
        if not re.fullmatch(r"report-[a-f0-9]{64}\.(html|json|zip)", result["filename"]):
            raise StateError("ANALYSIS_REPORT_EXPORT_LOCATION_CHANGED")
        path = self.database.directory / "analysis-exports" / result["filename"]
        if str(path) != result["path"]:
            raise StateError("ANALYSIS_REPORT_EXPORT_REGENERATE_AFTER_RECOVERY")
        return path, result


def serve(workspace, *, port=0):
    """Bind the private operator application only to numeric IPv4 loopback."""
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        server_version = "StellarForgeAnalysis"

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, *args):
            pass

        def _reply(self, status, body, mime="application/json", name=None):
            if not isinstance(body, bytes):
                body = _json(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self._headers(name)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _headers(self, name=None):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            if name:
                self.send_header("Content-Disposition", 'attachment; filename="' + name + '"')

        def _file_reply(self, path, record):
            """Verify and stream the same retained file descriptor."""
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size != record["bytes"]:
                    raise StateError("ANALYSIS_RETAINED_DOWNLOAD_CHANGED")
                if hashlib.file_digest(stream, "sha256").hexdigest() != record["sha256"]:
                    raise StateError("ANALYSIS_RETAINED_DOWNLOAD_CHANGED")
                stream.seek(0)
                self.send_response(200)
                self.send_header("Content-Type", record["mime"])
                self.send_header("Content-Length", str(info.st_size))
                self.send_header("X-Content-SHA256", record["sha256"])
                self._headers(record["filename"])
                self.end_headers()
                if self.command != "HEAD":
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        self.wfile.write(block)

        def _dispatch(self):
            origin = f"http://127.0.0.1:{self.server.server_port}"
            if self.headers.get("Host") != origin[7:] or self.headers.get("Origin", origin) != origin or self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}:
                return self._reply(403, {"error": "ANALYSIS_LOCAL_ORIGIN_REQUIRED"})
            url = urlsplit(self.path)
            if url.scheme or url.netloc or url.fragment:
                return self._reply(400, {"error": "ANALYSIS_ROUTE_INVALID"})
            assets = {"/": (_analysis_ui.HTML, "text/html;charset=utf-8"), "/app.js": (_analysis_ui.JS, "text/javascript;charset=utf-8"), "/style.css": (_analysis_ui.CSS, "text/css;charset=utf-8")}
            if self.command in {"GET", "HEAD"} and url.path in assets and not url.query:
                body, mime = assets[url.path]
                return self._reply(200, body.encode(), mime)
            if not secrets.compare_digest(self.headers.get("X-Analysis-Capability", ""), token):
                return self._reply(403, {"error": "ANALYSIS_CAPABILITY_REQUIRED"})
            query = parse_qs(url.query, strict_parsing=True)
            if any(len(v) != 1 for v in query.values()):
                raise StateError("ANALYSIS_QUERY_PARAMETERS_INVALID")
            get = lambda key, default=None: query.get(key, [default])[0]
            parts = url.path.strip("/").split("/")
            if (self.command in {"GET", "HEAD"} and len(parts) == 4
                    and parts[:2] == ["api", "query-exports"] and parts[3] == "file"):
                if set(query) != {"name"}:
                    raise StateError("ANALYSIS_EXPORT_FILE_REQUIRED")
                with workspace.exports.download(parts[2], get("name")) as (stream, record):
                    send_export(self, stream, record)
                return
            if self.command == "GET":
                if url.path == "/api/state":
                    return self._reply(200, workspace.state())
                if url.path == "/api/query-exports":
                    if set(query) - {"before", "limit"}:
                        raise StateError("ANALYSIS_EXPORT_PAGE_INVALID")
                    return self._reply(200, workspace.exports.history(
                        before=int(get("before")) if get("before") else None, limit=int(get("limit", "25"))))
                if len(parts) == 3 and parts[:2] == ["api", "response-source"]:
                    return self._reply(200, workspace.responses.describe(parts[2], int(get("revision", "0")),
                        collection=get("collection"), sse_data=get("sse_data", "text")))
                if url.path == "/api/versions":
                    return self._reply(200, workspace.database.versions(before=int(get("before")) if get("before") else None, limit=25))
                if len(parts) == 3 and parts[:2] == ["api", "reports"]:
                    return self._reply(200, workspace.reports.definition(parts[2], revision=int(get("revision")) if get("revision") else None))
                if url.path == "/api/report-runs":
                    return self._reply(200, workspace.reports.history(name=get("name"), before=int(get("before")) if get("before") else None))
                if len(parts) == 3 and parts[:2] == ["api", "report-runs"]:
                    return self._reply(200, workspace.reports.result(parts[2], section=int(get("section", "0")), offset=int(get("offset", "0"))))
                if url.path == "/api/report-publications":
                    return self._reply(200, workspace.reports.publications(name=get("name"), before=int(get("before")) if get("before") else None))
                if len(parts) == 3 and parts[:2] == ["api", "report-export"]:
                    path, record = workspace.report_export_file(parts[2])
                    return self._file_reply(path, record)
                if url.path == "/api/changes":
                    return self._reply(200, workspace.changes.history(before=int(get("before")) if get("before") else None))
                if len(parts) == 3 and parts[:2] == ["api", "changes"]:
                    return self._reply(200, workspace.changes.page(parts[2], kind=get("kind", "all"), after=int(get("after", "0"))))
                if len(parts) == 3 and parts[:2] == ["api", "change-export"]:
                    path, record = workspace.change_export_file(parts[2])
                    return self._file_reply(path, record)
                if len(parts) == 3 and parts[:2] == ["api", "version"]:
                    return self._reply(200, workspace.database.version(parts[2]))
                if len(parts) == 3 and parts[:2] == ["api", "manifest"]:
                    return self._reply(200, workspace.database.manifest_bytes(parts[2]), "application/json", "source-manifest.json")
                if len(parts) == 3 and parts[:2] == ["api", "queries"]:
                    return self._reply(200, workspace.saved_query(parts[2], revision=int(get("revision")) if get("revision") else None))
                if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
                    return self._reply(200, workspace.job(parts[2], offset=int(get("offset", "0"))))
                if len(parts) == 3 and parts[:2] == ["api", "result"]:
                    body, mime, name = workspace.export_result(parts[2], get("format", "json"))
                    return self._reply(200, body, mime, name)
                if len(parts) == 3 and parts[:2] == ["api", "backup"]:
                    path = workspace.backup_file(parts[2])
                    raw = read(path, _MAX_DOWNLOAD)
                    if digest(raw) != workspace._job(parts[2])["result"]["sha256"]:
                        raise StateError("ANALYSIS_BACKUP_CHANGED")
                    return self._reply(200, raw, "application/vnd.sqlite3", "datasets.sqlite3")
            elif self.command == "POST" and not url.query:
                if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                    return self._reply(415, {"error": "ANALYSIS_JSON_REQUIRED"})
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= _MAX_BODY:
                    return self._reply(413, {"error": "ANALYSIS_REQUEST_SIZE_INVALID"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise StateError("ANALYSIS_REQUEST_INCOMPLETE")
                body = parse(raw)
                if not isinstance(body, dict):
                    raise StateError("ANALYSIS_REQUEST_OBJECT_REQUIRED")
                if url.path == "/api/native-dataset-source":
                    from .analysis_native import attach_dataset
                    return self._reply(200, attach_dataset(workspace, body))
                if len(parts) == 4 and parts[:2] == ["api", "query-exports"] and parts[3] == "cancel":
                    if body:
                        raise StateError("ANALYSIS_EXPORT_CANCEL_FIELDS_INVALID")
                    return self._reply(200, workspace.exports.cancel(parts[2]))
                if url.path == "/api/object-source":
                    return self._reply(200, workspace.responses.register(body.get("name"), "object",
                        session=body.get("session"), destination=body.get("destination"),
                        format=body.get("format", "json"), expected_revision=body.get("expected_revision", 0)))
                if url.path == "/api/activate":
                    return self._reply(200, workspace.database.activate(body.get("name"), body.get("version_id"), expected_revision=body.get("expected_revision")))
                if len(parts) == 4 and parts[:2] == ["api", "changes"] and parts[3] == "select":
                    return self._reply(200, workspace.changes.select(parts[2], body))
                if len(parts) == 3 and parts[:2] == ["api", "reports"]:
                    return self._reply(200, workspace.reports.save(parts[2], body))
                if len(parts) == 4 and parts[:2] == ["api", "report-runs"] and parts[3] == "publish":
                    return self._reply(200, workspace.reports.publish(parts[2], body))
                if len(parts) == 3 and parts[:2] == ["api", "queries"]:
                    return self._reply(200, workspace.save_query(parts[2], body, expected_revision=body.get("expected_revision")))
                if len(parts) == 3 and parts[:2] == ["api", "start"]:
                    return self._reply(202, workspace.start(parts[2], body))
            self._reply(404, {"error": "ANALYSIS_NOT_FOUND"})

        def _handle(self):
            try:
                self._dispatch()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except (BuyerError, ValueError, TypeError, OverflowError) as exc:
                code = getattr(exc, "code", None) or str(exc) if isinstance(exc, BuyerError) else "ANALYSIS_REQUEST_INVALID"
                self._reply(409 if "CHANGED" in str(code) or "RUNNING" in str(code) else 400, {"error": str(code)[:256]})
            except Exception:
                self._reply(500, {"error": "ANALYSIS_OPERATION_FAILED"})

        do_GET = do_POST = do_HEAD = _handle

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = False
    url = f"http://127.0.0.1:{server.server_port}/#" + token
    control = workspace.database.directory / "analysis-launch.json"
    dump(control, {"schema": _SCHEMA, "workspace_id": workspace.identity, "url": url, "pid": os.getpid()})
    return server, control, url


def main():
    parser = argparse.ArgumentParser(description="Use original acquired datasets in a durable local analysis workspace.")
    parser.add_argument("--database", required=True, help="Original private DatasetDatabase directory")
    parser.add_argument("--checkout", help="Matching full native Stellar Forge checkout/runtime, required for imports")
    parser.add_argument("--node", default="node")
    commands = parser.add_subparsers(dest="command", required=True)
    launch = commands.add_parser("serve", help="Open the local browser application")
    launch.add_argument("--port", type=int, default=0)
    launch.add_argument("--open", action="store_true")
    source = commands.add_parser("source", help="Register an existing native acquisition; it never executes it")
    source.add_argument("--name", required=True)
    source.add_argument("--session", required=True)
    source.add_argument("--room", help="Existing SF100 room, or a new private destination")
    source.add_argument("--expected-revision", type=int, default=0)
    response = commands.add_parser("response", help="Register a retained native API response or original typed stream export")
    response.add_argument("--name", required=True)
    response.add_argument("--input-kind", required=True, choices=["buyer", "sf31", "stream", "mcp", "object"])
    response.add_argument("--config", help="Original SF88 configuration or SF31 response-file writer options")
    response.add_argument("--result", help="Original SF88 result record or SF31 response-file receipt")
    response.add_argument("--stream-export", help="Original Python StreamDelivery directory")
    response.add_argument("--manifest", help="Original native MCP result .meta.json file")
    response.add_argument("--object-session", help="Existing COMPLETE native ObjectSession directory")
    response.add_argument("--object-destination", help="Selected recorded object assembly; defaults to the latest recorded assembly")
    response.add_argument("--format", choices=["json", "csv"], default="json")
    response.add_argument("--expected-revision", type=int, default=0)
    commands.add_parser("status", help="Read saved sources, queries, views and work")
    args = parser.parse_args()
    if args.command == "status":
        print(_json(AnalysisWorkspace.read_state(args.database)))
        return
    workspace = AnalysisWorkspace(args.database, checkout=args.checkout, node=args.node)
    try:
        if args.command == "source":
            print(_json(workspace.register_source(args.name, args.session, room=args.room, expected_revision=args.expected_revision)))
        elif args.command == "response":
            print(_json(workspace.responses.register(args.name, args.input_kind, config=args.config, result=args.result,
                stream=args.stream_export, manifest=args.manifest, session=args.object_session, destination=args.object_destination,
                format=args.format, expected_revision=args.expected_revision)))
        else:
            server, control, url = serve(workspace, port=args.port)
            print(_json({"status": "LISTENING", "address": url.split("#", 1)[0], "private_launch": str(control)}), flush=True)
            if args.open:
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
    finally:
        workspace.close()


if __name__ == "__main__":
    main()
