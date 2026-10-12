"""Complete column profiles on the original immutable customer dataset tables.

No data acquisition or SQL-store replacement. Frequencies are grouped by native
storage class AND value, so integer 1, real 1.0 and text '1' remain distinct.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import html
import json
import math
from pathlib import Path
import re
import sqlite3
import threading
import time

from .errors import StateError
from .sqlite_dataset import _identifier
from .storage import digest, parse, read, write

SCHEMA = "stellar-forge.customer-data-profile.v1"
DOCUMENT = "stellar-forge.customer-data-profile-document.v1"
COMPARISON = "stellar-forge.customer-data-profile-comparison.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_SHA = re.compile(r"[a-f0-9]{64}")
_MAX_DOCUMENT = 32 * 1024 * 1024
_METRICS = ("rows", "null_rows", "empty_text_rows", "whitespace_text_rows", "distinct_nonnull", "duplicate_nonnull_rows")


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("DATA_PROFILE_REQUEST_ID_REQUIRED")
    return value


def _sha(value):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        raise StateError("DATA_PROFILE_DIGEST_REQUIRED")
    return value


def _sealed(value, key="sha256"):
    return {**value, key: digest(_json(value).encode())}


def _verified(value, key="sha256"):
    if not isinstance(value, dict) or value.get(key) != digest(_json({k: v for k, v in value.items() if k != key}).encode()):
        raise StateError("DATA_PROFILE_RETAINED_RECORD_CHANGED")
    return value


def _value(value, *, preview=384):
    """Exact scalar text; long strings carry an explicitly abbreviated preview."""
    if value is None:
        return {"type": "null", "text": ""}
    if type(value) is int:
        return {"type": "integer", "text": str(value)}
    if type(value) is float and math.isfinite(value):
        return {"type": "real", "text": repr(value)}
    if isinstance(value, str):
        raw = value.encode()
        return {"type": "text", "text": value[:preview], "truncated": len(value) > preview,
                "characters": len(value), "utf8_bytes": len(raw), "sha256": digest(raw)}
    raise StateError("DATA_PROFILE_NATIVE_SCALAR_REQUIRED")


def _portable_version(version):
    # Retain original delivery/query scope, but not the operator's private paths.
    return {key: version[key] for key in (
        "version_id", "manifestSha256", "sourceBindingSha256", "columns", "dataset", "column_types",
        "row_count", "jsonl", "row_representation", "originalPaymentStatus", "source_pages") if key in version}


def compare_profiles(before, after):
    """Compare exact complete profile metrics, not sampled rows or inferred drift."""
    before, after = _verified(before), _verified(after)
    if before.get("schema") != SCHEMA or after.get("schema") != SCHEMA:
        raise StateError("DATA_PROFILE_FORMAT_MISMATCH")
    left = {c["column"]: c for c in before["columns"]}
    right = {c["column"]: c for c in after["columns"]}
    columns = []
    for name in [*left, *(name for name in right if name not in left)]:
        b, a = left.get(name), right.get(name)
        changed = b is None or a is None or any(b.get(k) != a.get(k) for k in (
            *_METRICS, "storage_classes", "numeric_min", "numeric_max", "text_min", "text_max", "value_distribution_sha256", "original_json_types", "source_field"))
        columns.append({"column": name, "status": "added" if b is None else "removed" if a is None else "changed" if changed else "unchanged",
            "before": b, "after": a, "deltas": {k: a[k] - b[k] for k in _METRICS} if a and b else None})
    return _sealed({"schema": COMPARISON, "before_id": before["id"], "after_id": after["id"],
        "before_sha256": before["sha256"], "after_sha256": after["sha256"],
        "before_source": before["source"], "after_source": after["source"],
        "row_delta": after["row_count"] - before["row_count"], "columns": columns,
        "basis": "column names as stored; original field mappings and acquisition scopes remain visible; no causal or statistical drift claim"})


class _Stopped(Exception):
    pass


class DatasetProfiles:
    """Saved profiles and optimistic analyst reviews in AnalysisWorkspace's DB."""

    def __init__(self, database):
        self.database = database
        self._mutex = threading.Lock()
        self._active = {}
        self._closing = False
        with database._connection() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS sf_analysis_profile_reviews(
                sequence INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES sf_analysis_jobs(id),
                revision INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,request_sha256 TEXT NOT NULL,
                record TEXT NOT NULL,UNIQUE(job_id,revision))""")

    def prepare(self, request):
        version_id = _sha(request.get("version_id"))
        columns = request.get("columns")
        if columns is not None and (not isinstance(columns, list) or not columns or not all(isinstance(c, str) for c in columns)
                                    or len(set(columns)) != len(columns)):
            raise StateError("DATA_PROFILE_COLUMNS_INVALID")
        top = request.get("top_values", 12)
        timeout = request.get("timeout", 3600)
        if type(top) is not int or not 1 <= top <= 50 or type(timeout) is not int or not 1 <= timeout <= 86400:
            raise StateError("DATA_PROFILE_OPTIONS_INVALID")
        return {"version_id": version_id, "columns": columns, "top_values": top, "timeout": timeout}

    def validate(self, db, spec):
        version = self.database._version(db, spec["version_id"])
        manifest = db.execute("SELECT manifest FROM sf_dataset_versions WHERE version_id=?", (spec["version_id"],)).fetchone()[0]
        if digest(manifest) != version["manifestSha256"]:
            raise StateError("DATA_PROFILE_MANIFEST_CHANGED")
        available = [c["column"] for c in version["column_types"]]
        if spec["columns"] is not None and any(c not in available for c in spec["columns"]):
            raise StateError("DATA_PROFILE_COLUMN_NOT_IN_VERSION")
        if version["table"] != "sf_dataset_rows_" + spec["version_id"]:
            raise StateError("DATA_PROFILE_ORIGINAL_TABLE_REQUIRED")
        return version

    def _progress(self, job_id, **values):
        with self._mutex:
            self._active[job_id]["progress"].update(values)

    def progress(self, job_id):
        _id(job_id)
        with self._mutex:
            item = self._active.get(job_id)
            return dict(item["progress"]) if item else None

    def cancel(self, job_id):
        _id(job_id)
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT kind,status FROM sf_analysis_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None or row["kind"] != "profile":
            raise StateError("DATA_PROFILE_JOB_NOT_FOUND")
        if row["status"] != "RUNNING":
            return {"id": job_id, "status": row["status"], "requested": False}
        with self._mutex:
            item = self._active.setdefault(job_id, {"cancel": threading.Event(), "progress": {}})
            item["cancel"].set()
        return {"id": job_id, "status": "RUNNING", "requested": True}

    def cancel_all(self):
        with self._mutex:
            self._closing = True
            for item in self._active.values():
                item["cancel"].set()

    def run(self, job_id, spec):
        """Read one complete SQLite snapshot; publish only a complete result."""
        _id(job_id)
        started = time.monotonic()
        with self._mutex:
            item = self._active.setdefault(job_id, {"cancel": threading.Event(), "progress": {}})
            event = item["cancel"]
            if self._closing:
                event.set()
        deadline = started + spec["timeout"]
        def stop():
            if event.is_set():
                raise _Stopped()
            if time.monotonic() > deadline:
                raise StateError("DATA_PROFILE_DEADLINE_EXCEEDED")
        try:
            with self.database._connection(readonly=True) as db:
                db.execute("PRAGMA temp_store=FILE")
                db.execute("PRAGMA cache_size=-4096")
                db.execute("BEGIN")
                db.set_progress_handler(lambda: int(event.is_set() or time.monotonic() > deadline), 10000)
                try:
                    version = self.validate(db, spec)
                    table = _identifier(version["table"])
                    stop()
                    rows = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    if rows != version["row_count"]:
                        raise StateError("DATA_PROFILE_RETAINED_ROW_COUNT_CHANGED")
                    selected = [c for c in version["column_types"] if spec["columns"] is None or c["column"] in spec["columns"]]
                    self._progress(job_id, row_count=rows, columns_total=len(selected), columns_complete=0, current_column=None)
                    profiles = []
                    for index, column in enumerate(selected):
                        stop()
                        name, field = column["column"], _identifier(column["column"])
                        self._progress(job_id, current_column=name, columns_complete=index)
                        stats = {"column": name, "source_field": column["source"], "original_json_types": column["json_types"],
                            "rows": rows, "storage_classes": {k: 0 for k in ("null", "integer", "real", "text")},
                            "distinct_nonnull": 0, "null_rows": 0, "empty_text_rows": 0, "whitespace_text_rows": 0,
                            "top_values": [], "numeric_min": None, "numeric_max": None, "text_min": None, "text_max": None,
                            "text_characters_min": None, "text_characters_max": None, "text_utf8_bytes_min": None, "text_utf8_bytes_max": None}
                        observed, total, groups = hashlib.sha256(), 0, 0
                        extrema = {"numeric_min": None, "numeric_max": None, "text_min": None, "text_max": None}
                        sql = f"SELECT typeof({field}) AS kind,{field} AS value,COUNT(*) AS frequency FROM {table} GROUP BY typeof({field}),{field} COLLATE BINARY ORDER BY frequency DESC,kind,{field} COLLATE BINARY"
                        for group in db.execute(sql):
                            stop()
                            kind, value, count = group["kind"], group["value"], group["frequency"]
                            if kind not in stats["storage_classes"]:
                                raise StateError("DATA_PROFILE_NATIVE_SCALAR_REQUIRED")
                            total += count; groups += 1
                            stats["storage_classes"][kind] += count
                            cell = _value(value)
                            observed.update((_json({"value": cell, "rows": count}) + "\n").encode())
                            if len(stats["top_values"]) < spec["top_values"]:
                                stats["top_values"].append({"value": cell, "rows": count})
                            if value is None:
                                stats["null_rows"] = count
                            else:
                                stats["distinct_nonnull"] += 1
                            if kind == "text":
                                stats["empty_text_rows"] += count if not value else 0
                                stats["whitespace_text_rows"] += count if value and value.isspace() else 0
                                for metric, length in (("text_characters", len(value)), ("text_utf8_bytes", len(value.encode()))):
                                    for direction, fn in (("min", min), ("max", max)):
                                        key = metric + "_" + direction
                                        stats[key] = length if stats[key] is None else fn(stats[key], length)
                                category = "text"
                            elif kind in {"integer", "real"}:
                                category = "numeric"
                            else:
                                continue
                            for direction in ("min", "max"):
                                key = category + "_" + direction
                                previous = extrema[key]
                                if previous is None or (value < previous if direction == "min" else value > previous):
                                    extrema[key] = value
                            if groups % 2048 == 0:
                                self._progress(job_id, value_groups=groups, rows_grouped=total, elapsed_seconds=round(time.monotonic() - started, 3))
                        if total != rows:
                            raise StateError("DATA_PROFILE_INCOMPLETE_COLUMN")
                        for key, value in extrema.items():
                            stats[key] = _value(value) if value is not None else None
                        stats["distinct_including_null"] = groups
                        stats["duplicate_nonnull_rows"] = rows - stats["null_rows"] - stats["distinct_nonnull"]
                        stats["top_values_complete"] = len(stats["top_values"]) == groups
                        stats["value_distribution_sha256"] = observed.hexdigest()
                        profiles.append(stats)
                    stop()
                    result = _sealed({"schema": SCHEMA, "id": job_id, "completed_at": _now(), "complete": True,
                        "source": _portable_version(version), "row_count": rows, "columns": profiles,
                        "options": {k: v for k, v in spec.items() if k != "id"},
                        "scope": {"rows": "all imported rows", "columns": "all" if spec["columns"] is None else "selected",
                            "top_values": "frequency-ranked subset; all groups contribute to counts, extrema and distribution digest",
                            "nulls": "native SQL NULL; empty and whitespace-only text counted separately",
                            "types": "native SQLite storage classes; original JSON type declarations preserved; booleans already stored as integers",
                            "distinct": "storage class plus native BINARY value equality; integer and real values kept separate",
                            "numeric": "native numeric values only; decimal-looking text is never converted"}})
                    db.commit()
                except sqlite3.OperationalError:
                    stop()
                    raise
                finally:
                    db.set_progress_handler(None, 0)
            stop()
            raw = _json(result)
            if len(raw.encode()) > _MAX_DOCUMENT:
                raise StateError("DATA_PROFILE_RESULT_TOO_LARGE")
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                stop()
                changed = db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,finished_at=? WHERE id=? AND kind='profile' AND status='RUNNING'", (raw, result["completed_at"], job_id)).rowcount
                if changed != 1:
                    raise StateError("DATA_PROFILE_JOB_NOT_RUNNING")
                db.commit()
            return result
        except _Stopped:
            with self.database._connection() as db:
                db.execute("UPDATE sf_analysis_jobs SET status='CANCELLED',finished_at=?,error='DATA_PROFILE_CANCELLED' WHERE id=? AND kind='profile' AND status='RUNNING'", (_now(), job_id))
            return None
        finally:
            with self._mutex:
                self._active.pop(job_id, None)

    @staticmethod
    def _report(db, job_id):
        row = db.execute("SELECT status,result FROM sf_analysis_jobs WHERE id=? AND kind='profile'", (_id(job_id),)).fetchone()
        if row is None or row["status"] != "COMPLETE" or row["result"] is None:
            raise StateError("DATA_PROFILE_COMPLETE_RESULT_REQUIRED")
        result = _verified(parse(row["result"].encode()))
        if result.get("schema") != SCHEMA or result.get("id") != job_id:
            raise StateError("DATA_PROFILE_FORMAT_MISMATCH")
        return result

    @staticmethod
    def _review(db, job_id):
        row = db.execute("SELECT record FROM sf_analysis_profile_reviews WHERE job_id=? ORDER BY revision DESC LIMIT 1", (job_id,)).fetchone()
        return _verified(parse(row[0].encode())) if row else None

    def document(self, job_id):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            return ProfileDocument(_sealed({"schema": DOCUMENT, "profile": self._report(db, job_id), "review": self._review(db, job_id)}))

    def history(self, *, before=None, limit=25):
        if type(limit) is not int or not 1 <= limit <= 100 or before is not None and (type(before) is not int or before < 1):
            raise StateError("DATA_PROFILE_HISTORY_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,id,status,created_at,finished_at,error,request FROM sf_analysis_jobs WHERE kind='profile' AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", (before, before, limit + 1)).fetchall()
        return {"profiles": [{**{k: row[k] for k in row.keys() if k != "request"}, "version_id": parse(row["request"].encode())["version_id"], "progress": self.progress(row["id"])} for row in rows[:limit]],
                "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def save_review(self, job_id, request):
        job_id, request_id = _id(job_id), _id(request.get("id"))
        revision, note, decision = request.get("expected_revision"), request.get("note", ""), request.get("decision", "unclassified")
        notes = request.get("column_notes", {})
        if type(revision) is not int or revision < 0 or decision not in {"unclassified", "usable", "investigate", "reference"}:
            raise StateError("DATA_PROFILE_REVIEW_INVALID")
        if not isinstance(note, str) or len(note.encode()) > 16000 or not isinstance(notes, dict) or not all(isinstance(k, str) and isinstance(v, str) and len(v.encode()) <= 4000 for k, v in notes.items()):
            raise StateError("DATA_PROFILE_NOTES_INVALID")
        spec = {"id": request_id, "job_id": job_id, "profile_sha256": _sha(request.get("profile_sha256")),
                "expected_revision": revision, "note": note, "decision": decision, "column_notes": notes}
        sha = digest(_json(spec).encode())
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT request_sha256,record FROM sf_analysis_profile_reviews WHERE request_id=?", (request_id,)).fetchone()
            if old:
                if old[0] != sha:
                    raise StateError("DATA_PROFILE_REVIEW_ID_REUSED")
                return _verified(parse(old[1].encode()))
            report = self._report(db, job_id)
            if report["sha256"] != spec["profile_sha256"]:
                raise StateError("DATA_PROFILE_REVIEWED_RESULT_CHANGED")
            if set(notes) - {c["column"] for c in report["columns"]}:
                raise StateError("DATA_PROFILE_NOTE_COLUMN_UNKNOWN")
            current = self._review(db, job_id)
            if (current["revision"] if current else 0) != revision:
                raise StateError("DATA_PROFILE_REVIEW_REVISION_CHANGED")
            record = _sealed({**spec, "revision": revision + 1, "saved_at": _now()})
            db.execute("INSERT INTO sf_analysis_profile_reviews(job_id,revision,request_id,request_sha256,record) VALUES(?,?,?,?,?)", (job_id, revision + 1, request_id, sha, _json(record)))
            db.commit()
            return record

    def frequency_query(self, job_id, column):
        with self.database._connection(readonly=True) as db:
            report = self._report(db, job_id)
        if column not in {c["column"] for c in report["columns"]}:
            raise StateError("DATA_PROFILE_COLUMN_NOT_IN_RESULT")
        field = _identifier(column)
        table = _identifier("sf_dataset_rows_" + report["source"]["version_id"])
        return {"sql": f"SELECT typeof({field}) AS storage_type,{field} AS value,COUNT(*) AS frequency FROM {table} GROUP BY typeof({field}),{field} COLLATE BINARY ORDER BY frequency DESC,storage_type,{field} COLLATE BINARY", "parameters_text": "[]", "max_rows": 1000,
                "profile_id": job_id, "profile_sha256": report["sha256"], "version_id": report["source"]["version_id"],
                "description": "Complete frequency SQL on this original immutable edition; preview limits belong to the original query UI. Use its full-query export for every group."}

    def compare(self, before, after):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            return compare_profiles(self._report(db, before), self._report(db, after))


class ProfileDocument:
    """Portable profile/review; reopens without Node, a seller or the source DB."""
    def __init__(self, record):
        self.record = _verified(record)
        if record.get("schema") != DOCUMENT:
            raise StateError("DATA_PROFILE_DOCUMENT_FORMAT_MISMATCH")
        self.profile = _verified(record.get("profile"))
        if self.profile.get("schema") != SCHEMA or self.profile.get("complete") is not True:
            raise StateError("DATA_PROFILE_DOCUMENT_INCOMPLETE")
        self.review = record.get("review")
        if self.review is not None:
            _verified(self.review)
            if self.review.get("profile_sha256") != self.profile["sha256"] or self.review.get("job_id") != self.profile["id"]:
                raise StateError("DATA_PROFILE_REVIEW_BINDING_CHANGED")

    @classmethod
    def open(cls, path):
        return cls(parse(read(Path(path), _MAX_DOCUMENT)))

    def compare(self, other):
        return compare_profiles(self.profile, other.profile)

    def bytes(self, format="json"):
        if format == "json":
            return (_json(self.record) + "\n").encode()
        if format != "html":
            raise StateError("DATA_PROFILE_EXPORT_FORMAT_INVALID")
        return render_document(self).encode()

    def write(self, destination, *, format="json"):
        path = Path(destination)
        body = self.bytes(format)
        if len(body) > _MAX_DOCUMENT:
            raise StateError("DATA_PROFILE_DOCUMENT_TOO_LARGE")
        write(path, body, exclusive=True)
        return {"path": str(path), "bytes": len(body), "sha256": digest(body)}


_STYLE = """body{font:14px/1.5 system-ui,Arial;color:#242424;background:#fff;max-width:1100px;margin:36px auto;padding:0 20px}h1{font-size:28px}h2{margin-top:32px;font-size:20px}.muted{color:#666}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border:1px solid #ccc;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:14px}.scroll{overflow:auto}.note{white-space:pre-wrap;border-left:3px solid #555;padding:0 12px}@media print{body{margin:0}tr{break-inside:avoid}.scroll{overflow:visible}}"""


def render_document(document):
    p, review = document.profile, document.review
    esc = lambda value: html.escape(str(value), quote=True)
    cell = lambda value: "—" if value is None else esc(value["type"] + ": " + value["text"] + ("… [preview]" if value.get("truncated") else ""))
    rows = []
    for c in p["columns"]:
        rows.append("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in (c["column"], c["rows"], c["null_rows"], c["empty_text_rows"], c["distinct_nonnull"], c["duplicate_nonnull_rows"], ", ".join(f"{k}: {v}" for k, v in c["storage_classes"].items() if v))) + "</tr>")
    parts = [f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer data profile</title><style>{_STYLE}</style><body><p class="muted">STELLAR FORGE / CUSTOMER DATA</p><h1>Dataset column profile</h1><p>{p["row_count"]:,} imported rows · {len(p["columns"])} selected columns · {esc(p["completed_at"])}</p><p>Complete column statistics for the retained edition. Top values are frequency-ranked previews, not the full value dictionary.</p>',
        '<div class="scroll"><table><thead><tr><th>Column</th><th>Rows</th><th>Null</th><th>Empty text</th><th>Distinct non-null</th><th>Repeated non-null rows</th><th>Storage classes</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>']
    if review:
        parts += ["<h2>Analyst review</h2><p>" + esc(review["decision"]) + " · revision " + str(review["revision"]) + "</p><div class=\"note\">" + esc(review["note"]) + "</div>"]
    for c in p["columns"]:
        parts += ["<h2>" + esc(c["column"]) + "</h2><p>Original field: " + esc(c["source_field"]) + "; original JSON types: " + esc(", ".join(c["original_json_types"])) + "</p>",
            "<p>Numeric range: " + cell(c["numeric_min"]) + " → " + cell(c["numeric_max"]) + "<br>Text range (BINARY): " + cell(c["text_min"]) + " → " + cell(c["text_max"]) + "</p>",
            '<div class="scroll"><table><thead><tr><th>Value / storage class</th><th>Rows</th></tr></thead><tbody>' + "".join("<tr><td>" + cell(v["value"]) + "</td><td>" + str(v["rows"]) + "</td></tr>" for v in c["top_values"]) + "</tbody></table></div>"]
        if review and c["column"] in review["column_notes"]:
            parts.append('<p class="note">' + esc(review["column_notes"][c["column"]]) + "</p>")
    parts += ["<h2>Original edition and calculation scope</h2><pre>" + esc(json.dumps({"source": p["source"], "scope": p["scope"]}, ensure_ascii=False, indent=2)) + "</pre><p class=\"muted\">Profile " + esc(p["id"]) + " · " + esc(p["sha256"]) + "</p></body></html>"]
    return "".join(parts)
