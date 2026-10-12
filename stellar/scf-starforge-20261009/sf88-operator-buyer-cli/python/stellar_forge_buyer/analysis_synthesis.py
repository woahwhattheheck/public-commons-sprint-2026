"""Saved Research publications, synthesis protocols and outputs in Analysis.

Every version and output is part of the original DatasetDatabase. Its existing
SQLite snapshot and portable workspace receiving carry the complete analysis.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
import re
import threading

from .errors import StateError
from .evidence_synthesis import (analyze, canonical, content_sha256, descriptors_index,
    engine_information, need, review, validate_protocol)
from .synthesis_reports import make_outputs

SCHEMA = "stellar-forge.analysis-synthesis.v1"
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_JOB = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_MAX_SOURCE = 64 * 1024 * 1024
_MIMES = {".json": "application/json", ".csv": "text/csv;charset=utf-8",
          ".html": "text/html;charset=utf-8", ".svg": "image/svg+xml",
          ".zip": "application/zip"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _name(value):
    need(isinstance(value, str) and _NAME.fullmatch(value), "NAME_INVALID")
    return value


def _job(value):
    need(isinstance(value, str) and _JOB.fullmatch(value), "OPERATION_ID_REQUIRED")
    return value


def _hash(value):
    need(isinstance(value, str) and _HASH.fullmatch(value), "SHA256_REQUIRED")
    return value


def _revision(value, *, zero=False):
    need(type(value) is int and value >= (0 if zero else 1), "REVISION_REQUIRED")
    return value


def _pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, "SOURCE_DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def _parse_source(raw):
    def constant(_):
        raise StateError("ANALYSIS_SYNTHESIS_SOURCE_NONFINITE_JSON")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=constant)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise StateError("ANALYSIS_SYNTHESIS_SOURCE_JSON_INVALID") from None


def _pointer(document, pointer):
    need(isinstance(pointer, str) and (pointer == "" or pointer.startswith("/")), "JSON_POINTER_INVALID")
    current = document
    if pointer == "":
        return current
    for part in pointer[1:].split("/"):
        need(not re.search(r"~(?![01])", part), "JSON_POINTER_ESCAPE_INVALID")
        key = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict):
            need(key in current, "SOURCE_POINTER_NOT_FOUND")
            current = current[key]
        elif isinstance(current, list):
            need(bool(re.fullmatch(r"0|[1-9][0-9]*", key)), "SOURCE_ARRAY_INDEX_INVALID")
            index = int(key)
            need(index < len(current), "SOURCE_POINTER_NOT_FOUND")
            current = current[index]
        else:
            raise StateError("ANALYSIS_SYNTHESIS_SOURCE_POINTER_NOT_FOUND")
    return current


def publication_descriptors(raw, *, results_pointer, descriptor_pointer):
    source = _parse_source(raw)
    selected = _pointer(source, results_pointer)
    need(isinstance(selected, list), "SOURCE_RESULT_ARRAY_REQUIRED")
    descriptors = [_pointer(item, descriptor_pointer) for item in selected]
    descriptors_index(descriptors)
    return descriptors


class AnalysisSynthesis:
    def __init__(self, workspace):
        self.workspace = workspace
        self.database = workspace.database
        self._mutex = threading.Lock()
        self._closing = threading.Event()
        self._cancel = {}
        self._progress = {}
        with self.database._connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sf_analysis_synthesis_publications(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL, revision INTEGER NOT NULL, sha256 TEXT NOT NULL,
                    results_pointer TEXT NOT NULL, descriptor_pointer TEXT NOT NULL,
                    source_context TEXT NOT NULL, raw BLOB NOT NULL,
                    descriptors TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(name,revision));
                CREATE TABLE IF NOT EXISTS sf_analysis_synthesis_protocols(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL, revision INTEGER NOT NULL, sha256 TEXT NOT NULL,
                    publication_name TEXT NOT NULL, publication_revision INTEGER NOT NULL,
                    publication_sha256 TEXT NOT NULL, definition TEXT NOT NULL,
                    created_at TEXT NOT NULL, UNIQUE(name,revision));
                CREATE TABLE IF NOT EXISTS sf_analysis_synthesis_operations(
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_sha256 TEXT NOT NULL,
                    response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sf_analysis_synthesis_runs(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT UNIQUE NOT NULL, request_sha256 TEXT NOT NULL,
                    summary TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sf_analysis_synthesis_files(
                    job_id TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
                    PRIMARY KEY(job_id,name));
            """)

    @staticmethod
    def _publication(row, *, descriptors=False):
        value = {key: row[key] for key in ("sequence", "name", "revision", "sha256",
                                           "results_pointer", "descriptor_pointer", "created_at")}
        value["source_context"] = json.loads(row["source_context"])
        value["bytes"] = row["raw_bytes"] if "raw_bytes" in row.keys() else len(row["raw"])
        value["result_count"] = row["result_count"] if "result_count" in row.keys() else len(json.loads(row["descriptors"]))
        if descriptors:
            value["results"] = json.loads(row["descriptors"])
        return value

    @staticmethod
    def _protocol(row):
        return {
            "sequence": row["sequence"], "name": row["name"], "revision": row["revision"],
            "sha256": row["sha256"], "created_at": row["created_at"],
            "publication": {"name": row["publication_name"], "revision": row["publication_revision"],
                            "sha256": row["publication_sha256"]},
            "definition": json.loads(row["definition"]),
        }

    @staticmethod
    def _select(db, table, name, revision=None):
        _name(name)
        if revision is None:
            row = db.execute("SELECT * FROM " + table + " WHERE name=? ORDER BY revision DESC LIMIT 1",
                             (name,)).fetchone()
        else:
            _revision(revision)
            row = db.execute("SELECT * FROM " + table + " WHERE name=? AND revision=?",
                             (name, revision)).fetchone()
        need(row is not None, "SAVED_EDITION_NOT_FOUND")
        return row

    def _operation(self, db, request, kind):
        identifier = _job(request.get("id"))
        sha = content_sha256(request)
        old = db.execute("SELECT kind,request_sha256,response FROM sf_analysis_synthesis_operations WHERE id=?",
                         (identifier,)).fetchone()
        if old:
            need(old["kind"] == kind and old["request_sha256"] == sha, "OPERATION_ID_REUSED")
            return identifier, sha, json.loads(old["response"])
        return identifier, sha, None

    @staticmethod
    def _complete_operation(db, identifier, kind, sha, response):
        db.execute("INSERT INTO sf_analysis_synthesis_operations VALUES(?,?,?,?)",
                   (identifier, kind, sha, canonical(response)))

    def import_publication(self, request):
        need(isinstance(request, dict), "SOURCE_IMPORT_INVALID")
        _job(request.get("id")); name = _name(request.get("name"))
        expected = _revision(request.get("expected_revision"), zero=True)
        raw_text = request.get("raw_text")
        need(isinstance(raw_text, str), "COMPLETE_PUBLICATION_REQUIRED")
        raw = raw_text.encode("utf-8")
        need(0 < len(raw) <= _MAX_SOURCE, "SOURCE_SIZE_INVALID")
        sha = hashlib.sha256(raw).hexdigest()
        need(sha == _hash(request.get("expected_sha256")), "SOURCE_BYTES_CHANGED")
        context = request.get("source_context")
        need(isinstance(context, dict) and isinstance(context.get("kind"), str)
             and context["kind"].strip(), "SOURCE_CONTEXT_REQUIRED")
        canonical(context)
        results_pointer = request.get("results_pointer")
        descriptor_pointer = request.get("descriptor_pointer", "")
        descriptors = publication_descriptors(raw, results_pointer=results_pointer,
                                              descriptor_pointer=descriptor_pointer)
        with self.workspace._mutex:
            need(not self.workspace._closed, "WORKSPACE_CLOSED")
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                identifier, request_sha, old = self._operation(db, request, "publication")
                if old is not None:
                    return old
                current = db.execute("SELECT MAX(revision) FROM sf_analysis_synthesis_publications WHERE name=?",
                                     (name,)).fetchone()[0] or 0
                need(current == expected, "PUBLICATION_REVISION_CHANGED")
                db.execute("""INSERT INTO sf_analysis_synthesis_publications
                    (name,revision,sha256,results_pointer,descriptor_pointer,source_context,raw,descriptors,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (name, expected + 1, sha, results_pointer, descriptor_pointer, canonical(context),
                     raw, canonical(descriptors), _now()))
                row = self._select(db, "sf_analysis_synthesis_publications", name, expected + 1)
                response = self._publication(row)
                self._complete_operation(db, identifier, "publication", request_sha, response)
                db.commit()
        return response

    def save_protocol(self, request):
        need(isinstance(request, dict), "PROTOCOL_REQUEST_INVALID")
        name = _name(request.get("name"))
        expected = _revision(request.get("expected_revision"), zero=True)
        definition = validate_protocol(request.get("definition"))
        publication = request.get("publication")
        need(isinstance(publication, dict) and set(publication) == {"name", "revision", "sha256"},
             "PUBLICATION_EDITION_REQUIRED")
        _name(publication["name"]); _revision(publication["revision"]); _hash(publication["sha256"])
        with self.workspace._mutex:
            need(not self.workspace._closed, "WORKSPACE_CLOSED")
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                identifier, request_sha, old = self._operation(db, request, "protocol")
                if old is not None:
                    return old
                original = self._select(db, "sf_analysis_synthesis_publications",
                                        publication["name"], publication["revision"])
                need(original["sha256"] == publication["sha256"], "PUBLICATION_EDITION_CHANGED")
                review(definition, json.loads(original["descriptors"]), compute_effects=False)
                current = db.execute("SELECT MAX(revision) FROM sf_analysis_synthesis_protocols WHERE name=?",
                                     (name,)).fetchone()[0] or 0
                need(current == expected, "PROTOCOL_REVISION_CHANGED")
                sha = content_sha256({"definition": definition, "publication": publication})
                db.execute("""INSERT INTO sf_analysis_synthesis_protocols
                    (name,revision,sha256,publication_name,publication_revision,publication_sha256,definition,created_at)
                    VALUES(?,?,?,?,?,?,?,?)""",
                    (name, expected + 1, sha, publication["name"], publication["revision"],
                     publication["sha256"], canonical(definition), _now()))
                response = self._protocol(self._select(db, "sf_analysis_synthesis_protocols", name, expected + 1))
                self._complete_operation(db, identifier, "protocol", request_sha, response)
                db.commit()
        return response

    def history(self, *, kind="protocols", before=None, limit=25):
        need(kind in {"publications", "protocols", "runs"}, "HISTORY_KIND_INVALID")
        need(type(limit) is int and 1 <= limit <= 100, "PAGE_LIMIT_INVALID")
        if before is not None:
            need(type(before) is int and before >= 1, "PAGE_CURSOR_INVALID")
        table = {"publications": "sf_analysis_synthesis_publications",
                 "protocols": "sf_analysis_synthesis_protocols",
                 "runs": "sf_analysis_synthesis_runs"}[kind]
        columns = ("sequence,name,revision,sha256,results_pointer,descriptor_pointer,source_context,created_at,"
                   "length(raw) AS raw_bytes,json_array_length(descriptors) AS result_count") if kind == "publications" else "*"
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT " + columns + " FROM " + table +
                              (" WHERE sequence<?" if before is not None else "") +
                              " ORDER BY sequence DESC LIMIT ?", ((before, limit + 1) if before is not None else (limit + 1,))).fetchall()
        chosen = rows[:limit]
        if kind == "publications":
            items = [self._publication(row) for row in chosen]
        elif kind == "protocols":
            items = [self._protocol(row) for row in chosen]
        else:
            items = [{"sequence": row["sequence"], **json.loads(row["summary"])} for row in chosen]
        return {"schema": SCHEMA, "kind": kind, "items": items, "engine": engine_information(),
                "next_before": chosen[-1]["sequence"] if len(rows) > limit else None}

    def publication(self, name, *, revision=None, offset=0, limit=50):
        need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
             "SOURCE_PAGE_INVALID")
        need(offset == 0 or revision is not None, "SOURCE_PAGE_REVISION_REQUIRED")
        with self.database._connection(readonly=True) as db:
            row = self._select(db, "sf_analysis_synthesis_publications", name, revision)
            metadata = self._publication(row)
            values = json.loads(row["descriptors"])
        return {"publication": metadata,
                "results": [{"descriptor": value, "descriptor_sha256": content_sha256(value)}
                            for value in values[offset:offset + limit]],
                "offset": offset, "limit": limit, "total": len(values),
                "next_offset": offset + limit if offset + limit < len(values) else None}

    def protocol(self, name, *, revision=None):
        with self.database._connection(readonly=True) as db:
            return self._protocol(self._select(db, "sf_analysis_synthesis_protocols", name, revision))

    def review(self, name, *, revision):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            protocol = self._protocol(self._select(db, "sf_analysis_synthesis_protocols", name, revision))
            publication = self._select(db, "sf_analysis_synthesis_publications",
                                       protocol["publication"]["name"], protocol["publication"]["revision"])
            need(publication["sha256"] == protocol["publication"]["sha256"], "PUBLICATION_EDITION_CHANGED")
            descriptors = json.loads(publication["descriptors"])
        result = review(protocol["definition"], descriptors, compute_effects=engine_information()["ready"])
        return {"saved_protocol": protocol, **result}

    def prepare(self, request):
        need(isinstance(request, dict) and set(request) == {
            "id", "protocol_name", "protocol_revision", "protocol_sha256"}, "JOB_REQUEST_FIELDS_INVALID")
        _job(request["id"]); _name(request["protocol_name"]); _revision(request["protocol_revision"])
        _hash(request["protocol_sha256"])
        protocol = self.protocol(request["protocol_name"], revision=request["protocol_revision"])
        need(protocol["sha256"] == request["protocol_sha256"], "REVIEWED_PROTOCOL_CHANGED")
        return {key: request[key] for key in ("protocol_name", "protocol_revision", "protocol_sha256")} | {
            "publication_name": protocol["publication"]["name"],
            "publication_revision": protocol["publication"]["revision"],
            "publication_sha256": protocol["publication"]["sha256"]}

    def validate(self, db, spec):
        protocol = self._select(db, "sf_analysis_synthesis_protocols",
                               spec["protocol_name"], spec["protocol_revision"])
        need(protocol["sha256"] == spec["protocol_sha256"], "REVIEWED_PROTOCOL_CHANGED")
        need(protocol["publication_name"] == spec["publication_name"] and
             protocol["publication_revision"] == spec["publication_revision"] and
             protocol["publication_sha256"] == spec["publication_sha256"], "JOB_PUBLICATION_CHANGED")
        source = self._select(db, "sf_analysis_synthesis_publications",
                              spec["publication_name"], spec["publication_revision"])
        need(source["sha256"] == spec["publication_sha256"] and
             hashlib.sha256(source["raw"]).hexdigest() == source["sha256"], "RETAINED_PUBLICATION_CHANGED")
        projected = publication_descriptors(bytes(source["raw"]), results_pointer=source["results_pointer"],
                                            descriptor_pointer=source["descriptor_pointer"])
        need(canonical(projected) == source["descriptors"], "RETAINED_DESCRIPTOR_PROJECTION_CHANGED")
        return protocol, source

    def _check(self, identifier):
        with self._mutex:
            event = self._cancel.get(identifier)
        if self._closing.is_set() or event is not None and event.is_set():
            raise StateError("ANALYSIS_SYNTHESIS_CANCELLED")

    def _set_progress(self, identifier, phase):
        with self._mutex:
            self._progress[identifier] = {"phase": phase, "updated_at": _now()}

    def progress(self, identifier):
        with self._mutex:
            return deepcopy(self._progress.get(identifier))

    def resume(self, identifier):
        _job(identifier)
        with self._mutex:
            self._cancel.pop(identifier, None)

    def cancel(self, identifier):
        _job(identifier)
        job = self.workspace._job(identifier)
        need(job["kind"] == "synthesis", "SYNTHESIS_JOB_REQUIRED")
        if job["status"] == "RUNNING":
            with self._mutex:
                self._cancel.setdefault(identifier, threading.Event()).set()
        return {"id": identifier, "status": job["status"], "cancel_requested": job["status"] == "RUNNING"}

    def close(self):
        self._closing.set()

    def _completed(self, db, identifier, request_sha):
        old = db.execute("SELECT request_sha256,summary FROM sf_analysis_synthesis_runs WHERE job_id=?",
                         (identifier,)).fetchone()
        if old is None:
            return None
        need(old["request_sha256"] == request_sha, "RUN_INPUT_CHANGED")
        summary = json.loads(old["summary"])
        files = db.execute("SELECT name,bytes,sha256,data FROM sf_analysis_synthesis_files WHERE job_id=? ORDER BY name",
                           (identifier,)).fetchall()
        expected = {v["name"]: v for v in summary["files"]}
        need(set(expected) == {row["name"] for row in files}, "RETAINED_OUTPUT_SET_CHANGED")
        for row in files:
            need(row["bytes"] == len(row["data"]) == expected[row["name"]]["bytes"] and
                 row["sha256"] == hashlib.sha256(row["data"]).hexdigest() == expected[row["name"]]["sha256"],
                 "RETAINED_OUTPUT_CHANGED")
        return summary

    def run(self, identifier, spec):
        _job(identifier)
        request_sha = content_sha256(spec)
        self._check(identifier)
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            old = self._completed(db, identifier, request_sha)
            if old is not None:
                return old
            saved_protocol, source = self.validate(db, spec)
            protocol = self._protocol(saved_protocol)
            publication = self._publication(source)
            descriptors = json.loads(source["descriptors"])
            raw = bytes(source["raw"])
        self._set_progress(identifier, "STUDY_EFFECTS_AND_SYNTHESIS")
        result = analyze(protocol["definition"], descriptors, cancelled=lambda: self._check(identifier))
        created = _now()
        metadata = {"schema": SCHEMA, "id": identifier, "workspace_id": self.workspace.identity,
                    "created_at": created, "protocol": protocol, "publication": publication,
                    "request_sha256": request_sha}
        result["saved_analysis"] = metadata
        self._set_progress(identifier, "FIGURES_AND_COMPLETE_REPORT")
        files = make_outputs(result, metadata, raw, cancelled=lambda: self._check(identifier))
        entries = [{"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                    "mime_type": next((mime for suffix, mime in _MIMES.items() if name.endswith(suffix)), "application/octet-stream")}
                   for name, data in sorted(files.items())]
        summary = {"schema": "stellar-forge.analysis-synthesis-run.v1", "id": identifier,
                   "created_at": created, "protocol": {k: protocol[k] for k in ("name", "revision", "sha256")},
                   "publication": {k: publication[k] for k in ("name", "revision", "sha256")},
                   "counts": result["review"]["counts"], "primary": result["primary"],
                   "engine": result["engine"], "files": entries}
        self._check(identifier)
        self._set_progress(identifier, "SAVE_COMPLETE_ANALYSIS")
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._check(identifier)
            self.validate(db, spec)
            old = self._completed(db, identifier, request_sha)
            if old is not None:
                return old
            job = db.execute("SELECT kind,status,request FROM sf_analysis_jobs WHERE id=?", (identifier,)).fetchone()
            need(job is not None and job["kind"] == "synthesis" and job["status"] == "RUNNING"
                 and json.loads(job["request"]) == spec, "ORIGINAL_JOB_OWNERSHIP_CHANGED")
            for entry in entries:
                db.execute("INSERT INTO sf_analysis_synthesis_files VALUES(?,?,?,?,?,?)",
                    (identifier, entry["name"], entry["bytes"], entry["sha256"],
                     entry["mime_type"], files[entry["name"]]))
            db.execute("INSERT INTO sf_analysis_synthesis_runs(job_id,request_sha256,summary,created_at) VALUES(?,?,?,?)",
                       (identifier, request_sha, canonical(summary), created))
            db.commit()
        self._set_progress(identifier, "COMPLETE")
        return summary

    def result(self, identifier):
        _job(identifier)
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT summary FROM sf_analysis_synthesis_runs WHERE job_id=?", (identifier,)).fetchone()
        need(row is not None, "RUN_NOT_COMPLETE")
        return json.loads(row["summary"])

    @contextmanager
    def download(self, identifier, name):
        _job(identifier)
        need(isinstance(name, str) and re.fullmatch(r"[a-z][a-z0-9-]*\.(json|csv|html|svg|zip)", name),
             "OUTPUT_NAME_INVALID")
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT bytes,sha256,mime,data FROM sf_analysis_synthesis_files WHERE job_id=? AND name=?",
                             (identifier, name)).fetchone()
        need(row is not None, "OUTPUT_NOT_FOUND")
        data = bytes(row["data"])
        need(len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"],
             "RETAINED_OUTPUT_CHANGED")
        with io.BytesIO(data) as stream:
            yield stream, {"filename": name, "name": name, "bytes": len(data),
                           "sha256": row["sha256"], "mime": row["mime"], "mime_type": row["mime"]}

    @contextmanager
    def download_publication(self, name, revision):
        with self.database._connection(readonly=True) as db:
            row = self._select(db, "sf_analysis_synthesis_publications", name, revision)
        data = bytes(row["raw"])
        need(hashlib.sha256(data).hexdigest() == row["sha256"], "RETAINED_PUBLICATION_CHANGED")
        with io.BytesIO(data) as stream:
            yield stream, {"filename": name + "-revision-" + str(revision) + ".json",
                           "name": name + "-revision-" + str(revision) + ".json",
                           "bytes": len(data), "sha256": row["sha256"], "mime": "application/json", "mime_type": "application/json"}
