"""Retained customer reports on the original analytical database and SQL reader."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import zipfile

from .errors import StateError
from .storage import digest, parse, private_directory

_SCHEMA = "stellar-forge.customer-report.v1"
_DEFINITION = "stellar-forge.customer-report-definition.v1"
_PUBLICATION = "stellar-forge.customer-report-publication.v1"
_NAME = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}")
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_TEMP = re.compile(r"\.reports-[a-zA-Z0-9_-]+")
_MAX_ROWS_BYTES = 32 * 1024 * 1024
_MAX_EXPORT_BYTES = 128 * 1024 * 1024
_PRINT_STYLE = """
:root{font:14px/1.5 Arial,Helvetica,sans-serif;color:#202020;background:#fff}
body{max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:28px;line-height:1.2}
h2{font-size:20px;margin-top:32px}h3{font-size:15px}p{white-space:pre-wrap}
.eyebrow{font-size:11px;letter-spacing:.08em;color:#555}
.meta{font-size:12px;color:#555;overflow-wrap:anywhere}.table-scroll{overflow:auto}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px 9px;border:1px solid #ccc;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}
th{background:#eee}.null{font-style:italic;color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;border:1px solid #ccc;padding:12px}
nav a{display:inline-block;margin-right:16px}a{color:inherit}.note{border-left:3px solid #555;padding-left:12px}
@media print{body{margin:0;max-width:none;padding:0}nav{display:none}thead{display:table-header-group}tr{break-inside:avoid}.table-scroll{overflow:visible}h2,h3{break-after:avoid}pre{max-height:none}}
@media(max-width:600px){body{margin:18px auto;padding:0 14px}h1{font-size:24px}}
"""


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _text(value, label, maximum, *, required=False):
    if not isinstance(value, str) or len(value.encode()) > maximum or "\0" in value or required and not value.strip():
        raise StateError("ANALYSIS_REPORT_" + label + "_INVALID")
    return value


def _name(value):
    if not isinstance(value, str) or not _NAME.fullmatch(value):
        raise StateError("ANALYSIS_REPORT_NAME_INVALID")
    return value


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("ANALYSIS_REPORT_REQUEST_ID_REQUIRED")
    return value


def _hash(value):
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise StateError("ANALYSIS_REPORT_DIGEST_REQUIRED")
    return value


def _revision(value, *, zero=False):
    if type(value) is not int or value < (0 if zero else 1):
        raise StateError("ANALYSIS_REPORT_REVISION_REQUIRED")
    return value


def _unpack(row):
    if row is None:
        raise StateError("ANALYSIS_REPORT_NOT_FOUND")
    raw = row["record"].encode()
    if digest(raw) != row["sha256"]:
        raise StateError("ANALYSIS_REPORT_RETAINED_RECORD_CHANGED")
    return parse(raw)


def _page(before, limit):
    if type(limit) is not int or not 1 <= limit <= 100 or before is not None and (type(before) is not int or before < 1):
        raise StateError("ANALYSIS_REPORT_PAGE_INVALID")


class AnalysisReports:
    """Compose original saved SQL into reviewed, portable customer reports.

    The workspace supplies its existing scalar encoder and parameter parser.
    Queries all use one original read transaction. Rows are staged privately,
    then the complete report and all rows commit together in the original DB.
    """

    def __init__(self, database, *, encode_cell, parse_parameters, changes):
        self.database = database
        self.encode_cell = encode_cell
        self.parse_parameters = parse_parameters
        self.changes = changes
        self.exports = private_directory(database.directory / "analysis-exports")
        # Called only after the original workspace's exclusive process lease.
        for path in self.exports.iterdir():
            if _TEMP.fullmatch(path.name):
                info = path.lstat()
                if stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077:
                    path.unlink()
        with database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_reports(name TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_report_history(sequence INTEGER PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,UNIQUE(name,revision))")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_report_rows(job_id TEXT NOT NULL REFERENCES sf_analysis_jobs(id),section INTEGER NOT NULL,row_number INTEGER NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(job_id,section,row_number))")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_report_publications(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,revision INTEGER NOT NULL,job_id TEXT NOT NULL REFERENCES sf_analysis_jobs(id),request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,UNIQUE(name,revision))")
            db.commit()

    @staticmethod
    def state(db):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf_analysis_reports'").fetchone() is None:
            return []
        return [{"name": row["name"], "revision": row["revision"], "sha256": row["sha256"],
                 "title": _unpack(row)["title"]}
                for row in db.execute("SELECT * FROM sf_analysis_reports ORDER BY name")]

    def save(self, name, request):
        name = _name(name)
        request_id = _id(request.get("id"))
        expected = _revision(request.get("expected_revision"), zero=True)
        title = _text(request.get("title"), "TITLE", 300, required=True)
        introduction = _text(request.get("introduction", ""), "INTRODUCTION", 16000)
        sections = request.get("sections")
        if not isinstance(sections, list) or not 1 <= len(sections) <= 12:
            raise StateError("ANALYSIS_REPORT_ONE_TO_TWELVE_SECTIONS_REQUIRED")
        proposed = []
        for section in sections:
            if not isinstance(section, dict):
                raise StateError("ANALYSIS_REPORT_SECTION_INVALID")
            parameters = section.get("parameters_text")
            if parameters is not None:
                self.parse_parameters(parameters)
            proposed.append({
                "title": _text(section.get("title"), "SECTION_TITLE", 300, required=True),
                "note": _text(section.get("note", ""), "SECTION_NOTE", 8000),
                "query_name": _name(section.get("query_name")),
                "query_revision": _revision(section.get("query_revision")),
                "parameters_text": parameters,
            })
        normalized = {"id": request_id, "name": name, "expected_revision": expected,
                      "title": title, "introduction": introduction, "sections": proposed}
        request_sha = digest(_json(normalized).encode())
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM sf_analysis_report_history WHERE request_id=?", (request_id,)).fetchone()
            if existing is not None:
                if existing["request_sha256"] != request_sha:
                    raise StateError("ANALYSIS_REPORT_REQUEST_ID_REUSED")
                result = _unpack(existing)
                db.commit()
                return result
            current = db.execute("SELECT revision FROM sf_analysis_reports WHERE name=?", (name,)).fetchone()
            if (current[0] if current else 0) != expected:
                raise StateError("ANALYSIS_REPORT_DEFINITION_CHANGED")
            pinned = []
            for ordinal, section in enumerate(proposed):
                row = db.execute("SELECT record FROM sf_analysis_query_history WHERE name=? AND revision=?",
                                 (section["query_name"], section["query_revision"])).fetchone()
                if row is None:
                    raise StateError("ANALYSIS_REPORT_SAVED_QUERY_NOT_FOUND")
                query = parse(row[0].encode())
                parameters = section["parameters_text"]
                if parameters is None:
                    parameters = query["parameters_text"]
                self.parse_parameters(parameters)
                pinned.append({**section, "ordinal": ordinal, "parameters_text": parameters,
                               "query": query, "query_sha256": digest(row[0].encode())})
            record = {"schema": _DEFINITION, "name": name, "revision": expected + 1,
                      "title": title, "introduction": introduction, "sections": pinned,
                      "saved_at": _now(), "request_id": request_id}
            raw = _json(record)
            sha = digest(raw.encode())
            db.execute("INSERT INTO sf_analysis_reports VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record,sha256=excluded.sha256",
                       (name, expected + 1, raw, sha))
            db.execute("INSERT INTO sf_analysis_report_history(name,revision,request_id,request_sha256,record,sha256) VALUES(?,?,?,?,?,?)",
                       (name, expected + 1, request_id, request_sha, raw, sha))
            db.commit()
            return record

    def definition(self, name, *, revision=None):
        name = _name(name)
        if revision is not None:
            _revision(revision)
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            if revision is None:
                row = db.execute("SELECT * FROM sf_analysis_reports WHERE name=?", (name,)).fetchone()
            else:
                row = db.execute("SELECT * FROM sf_analysis_report_history WHERE name=? AND revision=?", (name, revision)).fetchone()
            record = _unpack(row)
            current = db.execute("SELECT revision FROM sf_analysis_reports WHERE name=?", (name,)).fetchone()
            history = [dict(r) for r in db.execute("SELECT revision,sha256 FROM sf_analysis_report_history WHERE name=? ORDER BY revision DESC LIMIT 100", (name,))]
            head = db.execute("SELECT revision FROM sf_analysis_report_publications WHERE name=? ORDER BY revision DESC LIMIT 1", (name,)).fetchone()
            return {"definition": record, "sha256": row["sha256"], "head_revision": current[0],
                    "history": history, "publication_revision": head[0] if head else 0}

    def prepare(self, request):
        views = request.get("expected_views")
        if not isinstance(views, list) or len(_json(views).encode()) > 256 * 1024:
            raise StateError("ANALYSIS_REPORT_REVIEWED_VIEWS_REQUIRED")
        return {"name": _name(request.get("name")), "revision": _revision(request.get("revision")),
                "definition_sha256": _hash(request.get("definition_sha256")), "expected_views": views}

    def _input(self, db, spec):
        row = db.execute("SELECT * FROM sf_analysis_report_history WHERE name=? AND revision=?",
                         (spec["name"], spec["revision"])).fetchone()
        record = _unpack(row)
        if row["sha256"] != spec["definition_sha256"]:
            raise StateError("ANALYSIS_REPORT_DEFINITION_CHANGED")
        if self.database._views(db) != spec["expected_views"]:
            raise StateError("DATASET_SQL_VIEWS_CHANGED")
        return record

    def _data_reviews(self, db, views):
        """Carry the original comparison decision for each exact selected view."""
        selected = {(view["name"], view["revision"], view["version_id"]): view for view in views}
        result = []
        for row in db.execute("SELECT job_id FROM sf_analysis_change_selections ORDER BY rowid"):
            selection = self.changes._selection(db, row[0])
            activation = selection["activation"]
            key = (activation["name"], activation["revision"], activation["version"]["version_id"])
            if key not in selected:
                continue
            comparison = self.changes._report(db, row[0])
            if comparison["result_sha256"] != selection["result_sha256"]:
                raise StateError("ANALYSIS_REPORT_DATA_REVIEW_CHANGED")
            result.append({"view": selected[key], "comparison_id": row[0],
                           "comparison_result_sha256": comparison["result_sha256"],
                           "selection_id": selection["id"], "selection_sha256": digest(_json(selection).encode()),
                           "selected_at": selection["selected_at"], "review_note": selection["note"],
                           "previous_view": selection["previous_view"],
                           "baseline": {"version_id": comparison["baseline"]["version_id"], "dataset": comparison["baseline"]["dataset"]},
                           "candidate": {"version_id": comparison["candidate"]["version_id"], "dataset": comparison["candidate"]["dataset"]},
                           "schema_changes": comparison["schema_changes"], "counts": comparison["counts"],
                           "positions_changed": comparison["positions_changed"]})
        return result

    def run(self, job_id, spec):
        deadline = time.monotonic() + 60
        fd, temporary = tempfile.mkstemp(prefix=".reports-", dir=self.exports)
        temporary = Path(temporary)
        try:
            with os.fdopen(fd, "w+b") as spool:
                with self.database._connection(readonly=True) as db:
                    db.execute("BEGIN")
                    definition = self._input(db, spec)
                    workspace_id = db.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1").fetchone()[0]
                    sources, section_records, total_bytes, total_rows = {}, [], 0, 0
                    for section in definition["sections"]:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise StateError("ANALYSIS_REPORT_TIME_LIMIT")
                        query = section["query"]
                        result = self.database._query(db, query["sql"], self.parse_parameters(section["parameters_text"]),
                            max_rows=query["max_rows"], max_result_bytes=4 * 1024 * 1024,
                            timeout=min(20, remaining), expected_views=spec["expected_views"])
                        if result.truncated:
                            raise StateError("ANALYSIS_REPORT_INCOMPLETE_SECTION_" + str(section["ordinal"] + 1) + "_INCREASE_SAVED_QUERY_LIMIT_OR_NARROW_QUERY")
                        checksum, section_bytes = hashlib.sha256(), 0
                        for number, values in enumerate(result.rows, 1):
                            raw = _json([self.encode_cell(value) for value in values]).encode()
                            checksum.update(raw + b"\n")
                            section_bytes += len(raw) + 1
                            total_bytes += len(raw) + 1
                            total_rows += 1
                            if total_bytes > _MAX_ROWS_BYTES or time.monotonic() >= deadline:
                                raise StateError("ANALYSIS_REPORT_RESULT_LIMIT")
                            spool.write(raw + b"\n")
                        section_records.append({"ordinal": section["ordinal"], "title": section["title"], "note": section["note"],
                            "query_name": section["query_name"], "query_revision": section["query_revision"],
                            "query_sha256": section["query_sha256"], "parameters_text": section["parameters_text"],
                            "columns": list(result.columns), "row_count": len(result.rows),
                            "rows_sha256": checksum.hexdigest(), "row_bytes": section_bytes,
                            "read_tables": list(result.read_tables)})
                        for table in result.read_tables:
                            if table.startswith("sf_dataset_rows_") and _HASH.fullmatch(table[16:]):
                                original = self.database._version(db, table[16:])
                                sources[original["version_id"]] = {key: value for key, value in original.items()
                                    if key not in {"sourceDirectory", "sequence", "created_at"}}
                    report = {"schema": _SCHEMA, "job_id": job_id, "workspace_id": workspace_id,
                        "definition": definition, "definition_sha256": spec["definition_sha256"],
                        "views": spec["expected_views"], "sources": [sources[key] for key in sorted(sources)],
                        "data_reviews": self._data_reviews(db, [view for view in spec["expected_views"] if view["version_id"] in sources]),
                        "sections": section_records, "total_rows": total_rows, "row_bytes": total_bytes,
                        "completed_at": _now()}
                    report["result_sha256"] = digest(_json(report).encode())
                # The source snapshot is closed before the short write transaction.
                # Later view changes do not rewrite this retained report.
                spool.flush()
                spool.seek(0)
                with self.database._connection() as db:
                    db.execute("BEGIN IMMEDIATE")
                    job = db.execute("SELECT kind,status,request FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
                    if job is None or job["kind"] != "report" or job["status"] != "RUNNING" or parse(job["request"].encode()) != {"id": job_id, **spec}:
                        raise StateError("ANALYSIS_REPORT_JOB_CHANGED")
                    for section in section_records:
                        checksum = hashlib.sha256()
                        for number in range(1, section["row_count"] + 1):
                            line = spool.readline(_MAX_ROWS_BYTES + 1)
                            if not line.endswith(b"\n"):
                                raise StateError("ANALYSIS_REPORT_STAGING_CHANGED")
                            checksum.update(line)
                            raw = line[:-1]
                            db.execute("INSERT INTO sf_analysis_report_rows VALUES(?,?,?,?,?)",
                                       (job_id, section["ordinal"], number, raw.decode(), digest(raw)))
                        if checksum.hexdigest() != section["rows_sha256"]:
                            raise StateError("ANALYSIS_REPORT_STAGING_CHANGED")
                    if spool.read(1):
                        raise StateError("ANALYSIS_REPORT_STAGING_CHANGED")
                    db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,finished_at=? WHERE id=? AND status='RUNNING'",
                               (_json(report), report["completed_at"], job_id))
                    db.commit()
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _report(db, job_id):
        _id(job_id)
        row = db.execute("SELECT kind,status,result FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None or row["kind"] != "report" or row["status"] != "COMPLETE" or row["result"] is None:
            raise StateError("ANALYSIS_COMPLETE_REPORT_REQUIRED")
        report = parse(row["result"].encode())
        expected = digest(_json({key: value for key, value in report.items() if key != "result_sha256"}).encode())
        if report.get("schema") != _SCHEMA or report.get("job_id") != job_id or report.get("result_sha256") != expected:
            raise StateError("ANALYSIS_REPORT_RETAINED_RESULT_CHANGED")
        return report

    def history(self, *, name=None, before=None, limit=25):
        _page(before, limit)
        if name is not None:
            name = _name(name)
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            rows = db.execute("SELECT sequence,id,status,created_at,finished_at,error,request,result FROM sf_analysis_jobs WHERE kind='report' AND (? IS NULL OR sequence<?) ORDER BY sequence DESC",
                              (before, before))
            items = []
            for row in rows:
                request = parse(row["request"].encode())
                if name is not None and request["name"] != name:
                    continue
                item = {key: row[key] for key in ("sequence", "id", "status", "created_at", "finished_at", "error")}
                item.update(name=request["name"], revision=request["revision"])
                if row["status"] == "COMPLETE":
                    report = self._report(db, row["id"])
                    item.update(title=report["definition"]["title"], total_rows=report["total_rows"],
                                sections=len(report["sections"]), result_sha256=report["result_sha256"])
                items.append(item)
                if len(items) > limit:
                    break
            return {"reports": items[:limit], "next_before": items[limit - 1]["sequence"] if len(items) > limit else None}

    @staticmethod
    def _rows(db, report, section):
        checksum, count, size = hashlib.sha256(), 0, 0
        for row in db.execute("SELECT row_number,record,sha256 FROM sf_analysis_report_rows WHERE job_id=? AND section=? ORDER BY row_number",
                              (report["job_id"], section["ordinal"])):
            raw = row["record"].encode()
            count += 1
            if row["row_number"] != count or digest(raw) != row["sha256"]:
                raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")
            checksum.update(raw + b"\n")
            size += len(raw) + 1
            values = parse(raw)
            if len(values) != len(section["columns"]):
                raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")
            yield values
        if count != section["row_count"] or size != section["row_bytes"] or checksum.hexdigest() != section["rows_sha256"]:
            raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")

    def result(self, job_id, *, section=0, offset=0, limit=100):
        if type(section) is not int or section < 0 or type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise StateError("ANALYSIS_REPORT_RESULT_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            report = self._report(db, job_id)
            if section >= len(report["sections"]):
                raise StateError("ANALYSIS_REPORT_SECTION_NOT_FOUND")
            selected = report["sections"][section]
            rows = []
            for row in db.execute("SELECT row_number,record,sha256 FROM sf_analysis_report_rows WHERE job_id=? AND section=? AND row_number>? ORDER BY row_number LIMIT ?",
                                  (job_id, section, offset, limit)):
                raw = row["record"].encode()
                if digest(raw) != row["sha256"] or row["row_number"] != offset + len(rows) + 1:
                    raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")
                values = parse(raw)
                if len(values) != len(selected["columns"]):
                    raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")
                rows.append(values)
            if len(rows) != min(limit, max(0, selected["row_count"] - offset)):
                raise StateError("ANALYSIS_REPORT_RETAINED_ROWS_CHANGED")
            publications = [{"publication": _unpack(row), "sha256": row["sha256"]}
                            for row in db.execute("SELECT * FROM sf_analysis_report_publications WHERE job_id=? ORDER BY revision DESC LIMIT 20", (job_id,))]
            head = db.execute("SELECT revision FROM sf_analysis_report_publications WHERE name=? ORDER BY revision DESC LIMIT 1", (report["definition"]["name"],)).fetchone()
            return {"report": report, "section": selected, "rows": rows, "offset": offset,
                    "next_offset": offset + limit if offset + limit < selected["row_count"] else None,
                    "publications": publications, "publication_revision": head[0] if head else 0}

    def publish(self, job_id, request):
        request_id = _id(request.get("id"))
        normalized = {"id": request_id, "job_id": _id(job_id), "result_sha256": _hash(request.get("result_sha256")),
                      "expected_revision": _revision(request.get("expected_revision"), zero=True),
                      "note": _text(request.get("note", ""), "PUBLICATION_NOTE", 16000)}
        request_sha = digest(_json(normalized).encode())
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM sf_analysis_report_publications WHERE id=?", (request_id,)).fetchone()
            if old is not None:
                if old["request_sha256"] != request_sha:
                    raise StateError("ANALYSIS_REPORT_REQUEST_ID_REUSED")
                record = _unpack(old)
                db.commit()
                return record
            report = self._report(db, job_id)
            if report["result_sha256"] != normalized["result_sha256"]:
                raise StateError("ANALYSIS_REPORT_RESULT_CHANGED")
            name = report["definition"]["name"]
            head = db.execute("SELECT revision FROM sf_analysis_report_publications WHERE name=? ORDER BY revision DESC LIMIT 1", (name,)).fetchone()
            if (head[0] if head else 0) != normalized["expected_revision"]:
                raise StateError("ANALYSIS_REPORT_PUBLICATION_CHANGED")
            for section in report["sections"]:
                for _ in self._rows(db, report, section):
                    pass
            record = {"schema": _PUBLICATION, "id": request_id, "name": name,
                      "revision": normalized["expected_revision"] + 1, "job_id": job_id,
                      "title": report["definition"]["title"], "definition_revision": report["definition"]["revision"],
                      "definition_sha256": report["definition_sha256"], "result_sha256": report["result_sha256"],
                      "note": normalized["note"], "published_at": _now(),
                      "report_views": report["views"], "current_views_at_publication": self.database._views(db)}
            raw = _json(record)
            db.execute("INSERT INTO sf_analysis_report_publications(id,name,revision,job_id,request_sha256,record,sha256) VALUES(?,?,?,?,?,?,?)",
                       (request_id, name, record["revision"], job_id, request_sha, raw, digest(raw.encode())))
            db.commit()
            return record

    def publications(self, *, name=None, before=None, limit=25):
        _page(before, limit)
        if name is not None:
            name = _name(name)
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT * FROM sf_analysis_report_publications WHERE (? IS NULL OR name=?) AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                              (name, name, before, before, limit + 1)).fetchall()
            items = [{"sequence": row["sequence"], "publication": _unpack(row), "sha256": row["sha256"]} for row in rows[:limit]]
            return {"publications": items, "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def prepare_export(self, request):
        format = request.get("format")
        if format not in {"html", "json", "csv"}:
            raise StateError("ANALYSIS_REPORT_EXPORT_FORMAT_INVALID")
        return {"publication_id": _id(request.get("publication_id")),
                "publication_sha256": _hash(request.get("publication_sha256")), "format": format}

    def _export_input(self, db, spec):
        row = db.execute("SELECT * FROM sf_analysis_report_publications WHERE id=?", (spec["publication_id"],)).fetchone()
        publication = _unpack(row)
        if row["sha256"] != spec["publication_sha256"]:
            raise StateError("ANALYSIS_REPORT_PUBLICATION_CHANGED")
        report = self._report(db, publication["job_id"])
        if report["result_sha256"] != publication["result_sha256"]:
            raise StateError("ANALYSIS_REPORT_RESULT_CHANGED")
        return publication, report

    def _json_blocks(self, db, publication, report):
        yield ('{"schema":' + _json(_SCHEMA) + ',"publication":' + _json(publication) + ',"report":' + _json(report) + ',"tables":[').encode()
        for index, section in enumerate(report["sections"]):
            if index:
                yield b","
            yield ('{"ordinal":' + str(index) + ',"columns":' + _json(section["columns"]) + ',"rows":[').encode()
            first = True
            for values in self._rows(db, report, section):
                if not first:
                    yield b","
                yield _json(values).encode()
                first = False
            yield b"]}"
        yield b"]}\n"

    def _html_blocks(self, db, publication, report):
        esc = lambda value: html.escape(str(value), quote=True)
        definition = report["definition"]
        yield ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
            esc(definition["title"]) + '</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><style>' +
            _PRINT_STYLE + '</style></head><body><p class="eyebrow">STELLAR FORGE / CUSTOMER REPORT</p><h1>' +
            esc(definition["title"]) + '</h1><p class="meta">Published edition ' + str(publication["revision"]) +
            ' · ' + esc(publication["published_at"]) + ' · Report definition ' + str(definition["revision"]) +
            '</p><p>' + esc(definition["introduction"]) + '</p><p class="note">' + esc(publication["note"]) + '</p><nav>').encode()
        for section in report["sections"]:
            yield ('<a href="#section-' + str(section["ordinal"]) + '">' + esc(section["title"]) + '</a>').encode()
        yield b'<a href="#sources">Data and methods</a></nav>'
        for section in report["sections"]:
            yield ('<section id="section-' + str(section["ordinal"]) + '"><h2>' + esc(section["title"]) + '</h2><p>' +
                   esc(section["note"]) + '</p><p class="meta">' + str(section["row_count"]) +
                   ' complete rows · ' + esc(section["query_name"]) + ' revision ' + str(section["query_revision"]) +
                   '</p><div class="table-scroll"><table><thead><tr>').encode()
            for column in section["columns"]:
                yield ('<th scope="col">' + esc(column) + '</th>').encode()
            yield b"</tr></thead><tbody>"
            for values in self._rows(db, report, section):
                yield b"<tr>"
                for value in values:
                    null = value["type"] == "null"
                    yield ('<td' + (' class="null"' if null else "") + ' title="' + esc(value["type"]) + '">' +
                           esc("NULL" if null else value["text"]) + '</td>').encode()
                yield b"</tr>"
            if not section["row_count"]:
                yield ('<tr><td colspan="' + str(max(1, len(section["columns"]))) + '">No rows returned.</td></tr>').encode()
            yield b"</tbody></table></div></section>"
        yield b'<section id="sources"><h2>Data and methods</h2><p>Every section used the same retained database snapshot. Source queries, projections and ordering describe the acquired editions; differences between selected editions do not by themselves establish changes at the provider.</p>'
        for review in report["data_reviews"]:
            yield ('<h3>Data selection: ' + esc(review["view"]["name"]) + '</h3><p class="note">' +
                   esc(review["review_note"]) + '</p><pre>' + esc(json.dumps(review, ensure_ascii=False, indent=2)) + '</pre>').encode()
        for source in report["sources"]:
            dataset = source.get("dataset", {})
            yield ('<h3>' + esc(dataset.get("name") or "Acquired dataset") + '</h3><p class="meta">Version ' +
                   esc(source["version_id"]) + ' · ' + str(source["row_count"]) + ' acquired rows</p><pre>' +
                   esc(json.dumps({"dataset": dataset, "column_types": source["column_types"],
                                   "manifestSha256": source["manifestSha256"], "jsonl": source["jsonl"]},
                                  ensure_ascii=False, indent=2)) + '</pre>').encode()
        for section, recipe in zip(report["sections"], definition["sections"]):
            yield ('<h3>' + esc(section["title"]) + ' — query</h3><pre>' + esc(recipe["query"]["sql"]) +
                   '\n\nParameters: ' + esc(section["parameters_text"]) + '</pre>').encode()
        yield ('<h3>Retained report</h3><pre>' + esc(json.dumps({"publication": publication,
            "workspace_id": report["workspace_id"], "job_id": report["job_id"], "completed_at": report["completed_at"],
            "views": report["views"], "definition_sha256": report["definition_sha256"],
            "result_sha256": report["result_sha256"]}, ensure_ascii=False, indent=2)) +
            '</pre></section></body></html>\n').encode()

    @staticmethod
    def _zip_info(name):
        entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100600 << 16
        entry._compresslevel = 6
        return entry

    def _csv_archive(self, stream, db, publication, report):
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            with archive.open(self._zip_info("report.json"), "w") as member:
                for block in self._json_blocks(db, publication, report):
                    member.write(block)
            with archive.open(self._zip_info("report.html"), "w") as member:
                for block in self._html_blocks(db, publication, report):
                    member.write(block)
            for section in report["sections"]:
                name = "sections/" + str(section["ordinal"] + 1).zfill(2) + "-" + section["query_name"] + ".csv"
                with archive.open(self._zip_info(name), "w") as member:
                    with io.TextIOWrapper(member, encoding="utf-8", newline="") as writer_stream:
                        writer = csv.writer(writer_stream)
                        writer.writerow(section["columns"])
                        for values in self._rows(db, report, section):
                            writer.writerow([value["text"] if value["type"] != "null" else "" for value in values])
                            if stream.tell() > _MAX_EXPORT_BYTES:
                                raise StateError("ANALYSIS_REPORT_EXPORT_LIMIT")
            with archive.open(self._zip_info("README.txt"), "w") as member:
                member.write(("Customer report: " + report["definition"]["title"] + "\n" +
                    "Each sections/*.csv file contains the complete table in report order. report.json retains scalar types, NULL, exact source queries and the original reviewed publication. report.html is the complete offline printable report. CSV uses original values; NULL and an empty string both appear as an empty CSV field.\n" +
                    "Publication: " + publication["id"] + "\nResult SHA-256: " + report["result_sha256"] + "\n").encode())

    def export(self, spec):
        fd, temporary = tempfile.mkstemp(prefix=".reports-", dir=self.exports)
        temporary = Path(temporary)
        try:
            with os.fdopen(fd, "w+b") as stream, self.database._connection(readonly=True) as db:
                db.execute("BEGIN")
                # Publication, report, and all table rows use one frozen snapshot.
                publication, report = self._export_input(db, spec)
                if spec["format"] == "csv":
                    self._csv_archive(stream, db, publication, report)
                else:
                    blocks = self._json_blocks(db, publication, report) if spec["format"] == "json" else self._html_blocks(db, publication, report)
                    for block in blocks:
                        stream.write(block)
                        if stream.tell() > _MAX_EXPORT_BYTES:
                            raise StateError("ANALYSIS_REPORT_EXPORT_LIMIT")
                stream.flush()
                os.fsync(stream.fileno())
                info = os.fstat(stream.fileno())
                if info.st_size > _MAX_EXPORT_BYTES:
                    raise StateError("ANALYSIS_REPORT_EXPORT_LIMIT")
                stream.seek(0)
                sha = hashlib.file_digest(stream, "sha256").hexdigest()
            extension, mime = {"html": ("html", "text/html;charset=utf-8"),
                               "json": ("json", "application/json"),
                               "csv": ("zip", "application/zip")}[spec["format"]]
            filename = "report-" + sha + "." + extension
            target = self.exports / filename
            try:
                os.link(temporary, target)
            except FileExistsError:
                existing = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(existing, "rb") as reader:
                    saved = os.fstat(reader.fileno())
                    if not stat.S_ISREG(saved.st_mode) or saved.st_nlink != 1 or saved.st_mode & 0o077 or saved.st_size != info.st_size or hashlib.file_digest(reader, "sha256").hexdigest() != sha:
                        raise StateError("ANALYSIS_REPORT_RETAINED_EXPORT_CHANGED")
            temporary.unlink()
            directory_fd = os.open(self.exports, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return {"schema": _SCHEMA, "publication_id": publication["id"], "publication_sha256": spec["publication_sha256"],
                    "job_id": report["job_id"], "result_sha256": report["result_sha256"],
                    "format": spec["format"], "filename": filename, "mime": mime,
                    "path": str(target), "bytes": info.st_size, "sha256": sha}
        finally:
            temporary.unlink(missing_ok=True)
