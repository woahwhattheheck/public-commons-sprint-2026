#!/usr/bin/env python3
"""Compensation data workbench: retained source, decisions and receiving results."""
from __future__ import annotations

import base64
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import uuid
import zipfile

SCHEMA = 1
MAX_IMPORT = 16 * 1024 * 1024
MAX_ROWS = 100000
FIELDS = {
    "jobs": ["id", "title", "description", "family", "level", "reference_amount", "currency", "period", "amount_scale", "annual_hours", "periods_per_year", "source_url"],
    "surveys": ["id", "job_title", "description", "publisher", "survey_name", "effective_date", "currency", "period", "amount_scale", "annual_hours", "periods_per_year", "p25", "p50", "p75", "geography", "industry", "organization_size", "cohort", "organizations", "respondents", "source_url"],
    "peers": ["id", "name", "cohort", "geography", "industry", "organization_size", "source_url"],
}
NUMBERS = {"reference_amount", "amount_scale", "annual_hours", "periods_per_year", "p25", "p50", "p75", "organizations", "respondents"}
ALIASES = {"id": ["id", "job_id", "record_id", "institution_id", "code"], "title": ["title", "job_title", "position"], "job_title": ["job_title", "survey_title", "title"], "name": ["name", "institution", "organization"], "p25": ["p25", "25th", "25th_percentile"], "p50": ["p50", "50th", "50th_percentile", "median"], "p75": ["p75", "75th", "75th_percentile"]}
EXTENSIONS = {"publisher": "publisher_intake.host", "receiving": "receiving.host"}


class JsonNumber(str):
    """An unrounded numeric JSON token, distinct from a localized text cell."""


class Problem(Exception):
    def __init__(self, message, status=422, code="INVALID_INPUT", details=None):
        super().__init__(message)
        self.status, self.code, self.details = status, code, details


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else stable(value).encode()).hexdigest()


def strict_json(text):
    def pairs(items):
        obj = {}
        for key, value in items:
            if key in obj:
                raise Problem("Duplicate JSON field: " + str(key))
            obj[key] = value
        return obj
    try:
        return json.loads(text, parse_float=JsonNumber, parse_constant=lambda x: (_ for _ in ()).throw(Problem("Non-finite number: " + x)), object_pairs_hook=pairs)
    except (ValueError, TypeError) as exc:
        raise Problem("Invalid JSON: " + str(exc)) from exc


def dec(value, field="number", blank=False, number_format="plain"):
    if value is None or value == "":
        if blank:
            return None
        raise Problem(field + " is required")
    if isinstance(value, bool):
        raise Problem(field + " must be a decimal number")
    if isinstance(value, (JsonNumber, int, float, Decimal)):
        number_format = "plain"
    s = str(value).strip()
    if number_format == "us_grouped" and re.fullmatch(r"-?\d{1,3}(,\d{3})*(\.\d+)?", s):
        s = s.replace(",", "")
    elif number_format == "decimal_comma" and re.fullmatch(r"-?\d{1,3}(\.\d{3})*(,\d+)?|-?\d+(,\d+)?", s):
        s = s.replace(".", "").replace(",", ".")
    if len(s) > 80 or not re.fullmatch(r"[+-]?\d+(\.\d+)?([eE][+-]?\d{1,3})?", s):
        raise Problem(field + " has an invalid decimal value for " + number_format)
    try:
        d = Decimal(s)
    except InvalidOperation as exc:
        raise Problem(field + " has an invalid decimal value") from exc
    if not d.is_finite() or abs(d) > Decimal("1e30"):
        raise Problem(field + " is outside the supported numeric range")
    return d


def ds(value):
    return format(value, "f") if isinstance(value, Decimal) else value


def required(value, field, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Problem(field + " must be nonblank text (maximum " + str(limit) + " characters)")
    return value.strip()


def iso_date(value, field, blank=False):
    if not value and blank:
        return None
    try:
        d = date.fromisoformat(str(value))
        if str(value) != d.isoformat():
            raise ValueError()
        return d
    except ValueError as exc:
        raise Problem(field + " must be YYYY-MM-DD") from exc


def file_digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".part")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def initialize(directory, title="Staff market workbench"):
    root = Path(directory).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    path = root / "workspace.sqlite3"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    os.close(fd)
    with sqlite3.connect(path) as db:
        db.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE blobs(sha TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,data BLOB NOT NULL);
        CREATE TABLE imports(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source_key TEXT NOT NULL,edition TEXT NOT NULL,
          created_at TEXT NOT NULL,raw_sha TEXT NOT NULL,status TEXT NOT NULL,imported_revision INTEGER,document TEXT NOT NULL,
          FOREIGN KEY(raw_sha) REFERENCES blobs(sha));
        CREATE TABLE records(id TEXT PRIMARY KEY,import_id TEXT NOT NULL,kind TEXT NOT NULL,record_key TEXT NOT NULL,
          sha TEXT NOT NULL,document TEXT NOT NULL,FOREIGN KEY(import_id) REFERENCES imports(id));
        CREATE INDEX records_source ON records(import_id,record_key);
        CREATE TABLE selections(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,survey_id TEXT NOT NULL,created_at TEXT NOT NULL,
          document TEXT NOT NULL,FOREIGN KEY(job_id) REFERENCES records(id),FOREIGN KEY(survey_id) REFERENCES records(id));
        CREATE TABLE analyses(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,created_at TEXT NOT NULL,document TEXT NOT NULL,
          FOREIGN KEY(job_id) REFERENCES records(id));
        CREATE TABLE reviews(id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,created_at TEXT NOT NULL,document TEXT NOT NULL,
          FOREIGN KEY(analysis_id) REFERENCES analyses(id));
        CREATE TABLE job_reviews(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,created_at TEXT NOT NULL,document TEXT NOT NULL,
          FOREIGN KEY(job_id) REFERENCES records(id));
        CREATE TABLE cycles(id TEXT PRIMARY KEY,updated_at TEXT NOT NULL,document TEXT NOT NULL);
        CREATE TABLE operations(id TEXT PRIMARY KEY,action TEXT NOT NULL,args_sha TEXT NOT NULL,
          created_at TEXT NOT NULL,revision INTEGER NOT NULL,result TEXT NOT NULL);
        """)
        metadata = {"schema": SCHEMA, "id": "workspace-" + uuid.uuid4().hex, "title": required(title, "title", 300), "revision": 0, "created_at": now()}
        for key, value in metadata.items():
            db.execute("INSERT INTO meta VALUES(?,?)", (key, stable(value)))
    return {"directory": str(root), **metadata}


class Workspace:
    def __init__(self, directory):
        self.root = Path(directory).expanduser().resolve()
        self.path = self.root / "workspace.sqlite3"
        if not self.path.is_file():
            raise Problem("Initialize or restore the workspace first", 404, "WORKSPACE_MISSING")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @staticmethod
    def meta(db):
        return {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT * FROM meta")}

    def mutate(self, action, body):
        if not isinstance(body, dict):
            raise Problem("Request must be a JSON object")
        operation = required(body.get("operation_id"), "operation_id", 200)
        args = {k: v for k, v in body.items() if k not in {"operation_id", "expected_revision"}}
        args_sha = digest({"action": action, "args": args})
        if not isinstance(action, str):
            raise Problem("Operation action must be text")
        method = getattr(self, "_" + action, None)
        name, separator, extension_action = action.partition(".")
        extension = self.extension(name) if name in EXTENSIONS and separator and extension_action else None
        if extension is None and action not in {"preview", "import", "selection", "job_review", "analysis", "review", "cycle", "title", "prepare_backup"}:
            raise Problem("Unknown operation", 404, "ACTION_MISSING")
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            meta = self.meta(db)
            old = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchone()
            if old:
                if old["args_sha"] != args_sha or old["action"] != action:
                    raise Problem("This operation ID already carries different arguments", 409, "OPERATION_CONFLICT")
                db.rollback()
                return {"revision": meta["revision"], "operation_revision": old["revision"], "replayed": True, "result": json.loads(old["result"])}
            if type(body.get("expected_revision")) is not int or body["expected_revision"] != meta["revision"]:
                raise Problem("Workspace changed. Reopen current data and reconcile the retained draft.", 409, "STALE_REVISION", {"current_revision": meta["revision"]})
            revision = meta["revision"] + 1
            result = extension.dispatch(self, db, extension_action, args, revision) if extension else method(db, args, revision)
            db.execute("UPDATE meta SET value=? WHERE key='revision'", (stable(revision),))
            db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?)", (operation, action, args_sha, now(), revision, stable(result)))
            db.commit()
            return {"revision": revision, "operation_revision": revision, "replayed": False, "result": result}
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def extension(name):
        if name not in EXTENSIONS:
            raise Problem("Unknown workspace extension", 404, "EXTENSION_MISSING")
        try:
            return importlib.import_module(EXTENSIONS[name])
        except ModuleNotFoundError as exc:
            if exc.name in {EXTENSIONS[name], EXTENSIONS[name].split(".")[0]}:
                raise Problem("This workspace extension has not been installed", 503, "EXTENSION_NOT_READY") from exc
            raise

    def extension_read(self, name, method="state", kind=None, identity=None):
        if method not in {"state", "document", "download"}:
            raise Problem("Unknown extension read", 404)
        extension = self.extension(name)
        db = self.connect()
        try:
            db.execute("PRAGMA query_only=ON")
            fn = getattr(extension, method, None)
            if fn is None:
                raise Problem("Extension read is absent", 404)
            return fn(self, db) if method == "state" else fn(self, db, kind, identity)
        finally:
            db.close()

    def _title(self, db, args, revision):
        title = required(args.get("title"), "title", 300)
        db.execute("UPDATE meta SET value=? WHERE key='title'", (stable(title),))
        return {"title": title}

    def _preview(self, db, args, revision):
        kind = args.get("kind")
        if kind not in FIELDS:
            raise Problem("Source kind must be jobs, surveys or peers")
        text = args.get("text")
        if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_IMPORT:
            raise Problem("Upload UTF-8 CSV/JSON no larger than 16 MiB")
        raw = text.encode("utf-8")
        filename = required(args.get("filename"), "filename", 300)
        source_name = required(args.get("source_name"), "source_name", 300)
        edition = required(args.get("edition"), "edition", 300)
        metadata = args.get("metadata", {})
        defaults = args.get("defaults", {})
        if not isinstance(metadata, dict) or not isinstance(defaults, dict):
            raise Problem("metadata and defaults must be objects")
        number_format = metadata.get("number_format", "plain")
        if number_format not in {"plain", "us_grouped", "decimal_comma"}:
            raise Problem("Unsupported numeric format")
        clean = text.lstrip("\ufeff")
        if filename.lower().endswith(".json") or clean.lstrip().startswith(("[", "{")):
            parsed = strict_json(clean)
            rows = parsed.get("records") if isinstance(parsed, dict) else parsed
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise Problem("JSON requires an array of objects or an object containing records")
            columns = list(dict.fromkeys(k for row in rows for k in row))
            numbered = [(i + 1, row) for i, row in enumerate(rows)]
        else:
            delimiter = args.get("delimiter", ",")
            if delimiter not in {",", ";", "\t"}:
                raise Problem("Select comma, semicolon or tab delimiter")
            reader = csv.DictReader(io.StringIO(clean, newline=""), delimiter=delimiter)
            columns = reader.fieldnames or []
            if not columns or len(set(columns)) != len(columns) or any(not c.strip() for c in columns):
                raise Problem("CSV requires distinct, nonblank column headings")
            numbered = []
            for row in reader:
                if None in row or any(v is None for v in row.values()):
                    raise Problem("CSV row " + str(reader.line_num) + " does not match its header width")
                numbered.append((reader.line_num, row))
        if len(numbered) > MAX_ROWS or len(columns) > 256:
            raise Problem("Source exceeds 100,000 rows or 256 columns")
        if not numbered:
            raise Problem("Source contains no records")
        mapping = args.get("mapping")
        if mapping is None:
            by_name = {str(c).strip().lower(): c for c in columns}
            mapping = {field: next((by_name[a] for a in ALIASES.get(field, [field]) if a in by_name), "") for field in FIELDS[kind]}
        if not isinstance(mapping, dict) or any(k not in FIELDS[kind] for k in mapping):
            raise Problem("Mapping must contain canonical fields for the selected source kind")
        if any(v and v not in columns for v in mapping.values()):
            raise Problem("Mapped column is absent from this source")
        source_key = kind + ":" + source_name.casefold()
        identity = {"kind": kind, "source_key": source_key, "edition": edition, "raw_sha256": digest(raw), "mapping": mapping, "metadata": metadata, "defaults": defaults, "delimiter": args.get("delimiter", ",")}
        preview_id = "source-" + digest(identity)
        existing = db.execute("SELECT document FROM imports WHERE id=?", (preview_id,)).fetchone()
        if existing:
            return self._preview_brief(json.loads(existing[0]))
        normalized, errors, seen = [], [], set()
        for row_number, original in numbered:
            record, row_errors, used_defaults = {}, [], []
            for field in FIELDS[kind]:
                value = original.get(mapping.get(field)) if mapping.get(field) else None
                if value in (None, "") and field in defaults:
                    value = defaults[field]
                    used_defaults.append(field)
                if isinstance(value, (dict, list, bool)):
                    row_errors.append(field + " must be a scalar text/number value")
                    record[field] = ""
                    continue
                try:
                    if field in NUMBERS:
                        d = dec(value, field, True, "plain" if field in used_defaults else number_format)
                        if d is not None and d < 0:
                            raise Problem(field + " must be nonnegative")
                        if field in {"organizations", "respondents"} and d is not None and d != d.to_integral():
                            raise Problem(field + " must be a whole count")
                        record[field] = ds(d)
                    else:
                        record[field] = str(value).strip() if value is not None else ""
                    if field == "effective_date" and record[field]:
                        iso_date(record[field], field)
                except Problem as exc:
                    row_errors.append(str(exc))
                    record[field] = None
            for field in ("id", "title" if kind == "jobs" else "job_title" if kind == "surveys" else "name"):
                if not record.get(field):
                    row_errors.append(field + " is required")
            key = record.get("id")
            if key in seen:
                row_errors.append("Duplicate record identity in the source: " + str(key))
            if key:
                seen.add(key)
            if kind == "surveys":
                points = [(name, dec(record[name], name, True)) for name in ("p25", "p50", "p75")]
                present = [(k, v) for k, v in points if v is not None]
                if any(present[i][1] > present[i+1][1] for i in range(len(present)-1)):
                    row_errors.append("Reported percentile values are not ordered")
            numeric_fields = [key for key, value in original.items() if isinstance(value, (JsonNumber, int, float, Decimal)) and not isinstance(value, bool)]
            normalized.append({"row": row_number, "record": record, "raw": original, "raw_numeric_fields": numeric_fields, "defaults_applied": used_defaults, "errors": row_errors})
            errors.extend({"row": row_number, "message": message} for message in row_errors)
        document = {"id": preview_id, **identity, "source_name": source_name, "filename": filename, "bytes": len(raw), "created_at": now(), "columns": columns, "records": normalized, "row_count": len(normalized), "errors": errors}
        db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?,?)", (digest(raw), filename, len(raw), raw))
        db.execute("INSERT INTO imports VALUES(?,?,?,?,?,?,?,NULL,?)", (preview_id, kind, source_key, edition, document["created_at"], digest(raw), "PREVIEW", stable(document)))
        return self._preview_brief(document)

    @staticmethod
    def _preview_brief(document):
        return {k: v for k, v in document.items() if k != "records"} | {"sample": document["records"][:30], "sample_count": min(30, document["row_count"])}

    def _import(self, db, args, revision):
        row = db.execute("SELECT * FROM imports WHERE id=?", (args.get("preview_id"),)).fetchone()
        if not row:
            raise Problem("Source preview does not exist", 404, "SOURCE_MISSING")
        document = json.loads(row["document"])
        if document["errors"]:
            raise Problem("Correct the source/mapping errors before import", details=document["errors"][:100])
        if row["status"] == "IMPORTED":
            return {"source_id": row["id"], "rows": document["row_count"], "reused": True}
        previous = db.execute("SELECT id FROM imports WHERE source_key=? AND status='IMPORTED' ORDER BY imported_revision DESC LIMIT 1", (row["source_key"],)).fetchone()
        old = {r["record_key"]: r["sha"] for r in db.execute("SELECT record_key,sha FROM records WHERE import_id=?", (previous[0],))} if previous else {}
        change = {"new": 0, "changed": 0, "unchanged": 0, "removed": 0}
        keys = set()
        for item in document["records"]:
            key = item["record"]["id"]
            keys.add(key)
            sha = digest(item["record"])
            change["new" if key not in old else "unchanged" if old[key] == sha else "changed"] += 1
            record_id = "record-" + digest({"source": row["id"], "key": key})
            native = {"id": record_id, "record_key": key, "source_id": row["id"], "source_key": row["source_key"], "source_name": document["source_name"], "edition": row["edition"], "source_sha256": row["raw_sha"], "sha256": sha, "kind": row["kind"], **item}
            db.execute("INSERT INTO records VALUES(?,?,?,?,?,?)", (record_id, row["id"], row["kind"], key, sha, stable(native)))
        change["removed"] = len(set(old) - keys)
        db.execute("UPDATE imports SET status='IMPORTED',imported_revision=? WHERE id=?", (revision, row["id"]))
        return {"source_id": row["id"], "rows": document["row_count"], "change": change, "previous_source_id": previous[0] if previous else None, "reused": False}

    @staticmethod
    def _record(db, record_id, kind=None):
        row = db.execute("SELECT document FROM records WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise Problem("Original record is absent", 404, "RECORD_MISSING")
        obj = json.loads(row[0])
        if kind and obj["kind"] != kind:
            raise Problem("Expected a " + kind + " record")
        return obj

    @staticmethod
    def _is_current(db, record):
        latest = db.execute("SELECT id FROM imports WHERE source_key=? AND status='IMPORTED' ORDER BY imported_revision DESC LIMIT 1", (record["source_key"],)).fetchone()
        return bool(latest and latest[0] == record["source_id"])

    def _publisher_scope(self, db, supplied):
        if not isinstance(supplied, dict) or supplied.get("kind") not in {"edition", "cohort"}:
            raise Problem("Choose the original reviewed publisher edition or cohort", 422, "PUBLISHER_SCOPE_INVALID")
        kind, identity = supplied["kind"], supplied.get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise Problem("The original reviewed publisher identity is required", 422, "PUBLISHER_SCOPE_INVALID")
        extension = self.extension("publisher")
        publisher = extension.document(self, db, kind, identity)
        expected_key = "editionHash" if kind == "edition" else "cohortHash"
        if publisher.get(expected_key) != identity:
            raise Problem("The publisher record differs from its original identity", 409, "PUBLISHER_SCOPE_INVALID")
        native = extension.document(self, db, kind + "-records", identity)
        rows = native.get("record_ids")
        if isinstance(rows, dict):
            rows = list(rows.values())
        if not isinstance(rows, list) or len(rows) > 100000 or any(not isinstance(row, str) for row in rows):
            raise Problem("The original publisher record links are incomplete", 409, "PUBLISHER_SCOPE_INVALID")
        identities = list(dict.fromkeys(rows))
        source = publisher.get("source") or {}
        origin = {"kind": kind, "id": identity, "edition_hash": publisher.get("editionHash"),
                  "native_source_id": native.get("source_id"), "record_count": len(identities),
                  "source": {key: source[key] for key in ("publisher_id", "publisher_name",
                      "survey_id", "survey_name", "edition_id", "effective_date") if key in source}}
        return origin, identities

    def _selection(self, db, args, revision):
        job = self._record(db, args.get("job_id"), "jobs")
        survey = self._record(db, args.get("survey_id"), "surveys")
        publisher_origin = None
        if args.get("publisher_origin") is not None:
            publisher_origin, identities = self._publisher_scope(db, args["publisher_origin"])
            if survey["id"] not in identities:
                raise Problem("The chosen survey row is outside this saved publisher group", 409, "PUBLISHER_SCOPE_INVALID")
        outcome = args.get("outcome", "selected")
        if outcome not in {"selected", "excluded"}:
            raise Problem("Selection outcome must be selected or excluded")
        reviewer = required(args.get("reviewer"), "reviewer", 300)
        rationale = required(args.get("rationale"), "match rationale")
        weight = dec(args.get("weight", "1"), "weight")
        adjustment = dec(args.get("scope_adjustment_pct", "0"), "scope adjustment")
        rate = dec(args.get("aging_rate_pct", "0"), "aging rate")
        day_basis = dec(args.get("day_basis", "365.25"), "day basis")
        if weight <= 0 or day_basis <= 0 or adjustment <= -100 or rate <= -100:
            raise Problem("Weight/day basis must be positive; adjustment/rate must be greater than -100%")
        mode = args.get("aging_mode", "none")
        if mode not in {"none", "linear", "compound"}:
            raise Problem("Aging mode must be none, linear or compound")
        if (adjustment != 0 or mode != "none") and not str(args.get("factor_rationale", "")).strip():
            raise Problem("Explain the selected adjustment or aging factor")
        document = {"id": "selection-" + uuid.uuid4().hex, "job_id": job["id"], "survey_id": survey["id"], "job_sha256": job["sha256"], "survey_sha256": survey["sha256"], "outcome": outcome, "reviewer": reviewer, "rationale": rationale, "weight": ds(weight), "scope_adjustment_pct": ds(adjustment), "aging_rate_pct": ds(rate), "day_basis": ds(day_basis), "aging_mode": mode, "factor_rationale": str(args.get("factor_rationale", "")), "created_at": now()}
        document["publisher_origin"] = publisher_origin
        db.execute("INSERT INTO selections VALUES(?,?,?,?,?)", (document["id"], job["id"], survey["id"], document["created_at"], stable(document)))
        return document

    def _job_review(self, db, args, revision):
        job = self._record(db, args.get("job_id"), "jobs")
        outcome = args.get("outcome")
        if outcome not in {"benchmark_candidate", "non_benchmark", "needs_source"}:
            raise Problem("Unknown job disposition")
        doc = {"id": "job-review-" + uuid.uuid4().hex, "job_id": job["id"], "job_sha256": job["sha256"], "source_id": job["source_id"], "outcome": outcome, "reviewer": required(args.get("reviewer"), "reviewer", 300), "rationale": required(args.get("rationale"), "job disposition rationale"), "created_at": now()}
        db.execute("CREATE TABLE IF NOT EXISTS job_reviews(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,created_at TEXT NOT NULL,document TEXT NOT NULL,FOREIGN KEY(job_id) REFERENCES records(id))")
        db.execute("INSERT INTO job_reviews VALUES(?,?,?,?)", (doc["id"], job["id"], doc["created_at"], stable(doc)))
        return doc

    @staticmethod
    def _annual_multiplier(record):
        scale = dec(record.get("amount_scale") or "1", "amount scale")
        if scale <= 0:
            raise Problem("Amount scale must be positive")
        period = str(record.get("period") or "").lower()
        if period == "annual":
            return scale, {"amount_scale": ds(scale), "period": "annual", "period_factor": "1"}
        factor_field = "annual_hours" if period == "hourly" else "periods_per_year"
        if period not in {"hourly", "monthly", "weekly", "biweekly", "semimonthly", "other"}:
            raise Problem("An explicit supported pay period is required")
        factor = dec(record.get(factor_field), factor_field)
        if factor <= 0:
            raise Problem(factor_field + " must be positive")
        return scale * factor, {"amount_scale": ds(scale), "period": period, "period_factor": ds(factor), "factor_field": factor_field}

    def _receiving_origin(self, db, supplied, job):
        if supplied is None:
            return None
        if not isinstance(supplied, dict) or supplied.get("kind") not in {"return-review", "annual-review"}:
            raise Problem("Choose the original saved receiving review", 422, "RECEIVING_ORIGIN_INVALID")
        record = self.extension("receiving").document(self, db, supplied["kind"], supplied.get("id"))
        key = supplied.get("entryKey")
        entries = [entry for entry in record.get("entries", []) if entry.get("key") == key]
        decisions = [item for item in record.get("decisions", []) if item.get("key") == key]
        if len(entries) != 1 or len(decisions) != 1 or decisions[0].get("action") not in {"request-pricing-review", "needs-pricing-review"}:
            raise Problem("This saved receiving row does not request a pricing review", 409, "RECEIVING_ORIGIN_INVALID")
        side = supplied.get("edition", "original" if record["kind"] == "return-review" else "current")
        if side not in ({"original"} if record["kind"] == "return-review" else {"previous", "current"}):
            raise Problem("Choose the original receiving edition", 422, "RECEIVING_ORIGIN_INVALID")
        source = (entries[0].get(side) or {}).get("source") or {}
        prior_id = (source.get("data") or {}).get("id")
        row = db.execute("SELECT document FROM analyses WHERE id=?", (prior_id,)).fetchone()
        if not row or source.get("id") != prior_id:
            raise Problem("The original pricing analysis is absent from this workspace", 409, "ANALYSIS_MISSING")
        prior = json.loads(row[0])
        if (source.get("data") or {}).get("result_sha256") != prior["result_sha256"]:
            raise Problem("Receiving review and original pricing result differ", 409, "RECEIVING_ORIGIN_INVALID")
        if (job["source_key"], job["record_key"]) != (prior["job"]["source_key"], prior["job"]["record_key"]):
            raise Problem("The receiving correction belongs to a different job", 409, "RECEIVING_ORIGIN_INVALID")
        return {"kind": record["kind"], "id": record["id"], "sha256": record["sha256"],
                "entry_key": key, "edition": side, "decision": decisions[0],
                "changes": entries[0].get("changes", []), "reviewer": record["createdBy"],
                "reviewed_at": record["createdAt"], "prior_analysis_id": prior_id,
                "prior_analysis_sha256": prior["result_sha256"],
                "source_sha256": (record.get("source") or {}).get("sha256")}

    def _analysis(self, db, args, revision):
        job = self._record(db, args.get("job_id"), "jobs")
        receiving_origin = self._receiving_origin(db, args.get("receiving_origin"), job)
        title = required(args.get("title"), "analysis title", 500)
        target = iso_date(args.get("target_date"), "target_date", True)
        basis = required(args.get("basis_note"), "analysis basis")
        source_mode = args.get("source_mode", "current")
        if source_mode not in {"current", "historical"}:
            raise Problem("Source mode must be current or historical")
        chosen = args.get("selection_ids")
        if not isinstance(chosen, list) or not chosen or len(chosen) != len(set(chosen)):
            raise Problem("Choose distinct recorded match decisions")
        lines, errors, warnings, currencies, observed_surveys = [], [], [], set(), set()
        if not target:
            warnings.append("No common target date selected; the retained source-date/worked-example basis applies")
        if source_mode == "current" and not self._is_current(db, job):
            errors.append("The selected job belongs to a superseded source edition")
        job_review = None
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_reviews'").fetchone():
            prior = db.execute("SELECT document FROM job_reviews WHERE job_id=? ORDER BY created_at DESC LIMIT 1", (job["id"],)).fetchone()
            job_review = json.loads(prior[0]) if prior else None
            if job_review and job_review["outcome"] in {"non_benchmark", "needs_source"}:
                errors.append("The recorded job disposition requires review before pricing: " + job_review["outcome"])
        with localcontext() as ctx:
            ctx.prec = 36
            for sid in chosen:
                row = db.execute("SELECT document FROM selections WHERE id=?", (sid,)).fetchone()
                if not row:
                    raise Problem("Match decision is absent", 404, "SELECTION_MISSING")
                selection = json.loads(row[0])
                if selection["job_id"] != job["id"] or selection["outcome"] != "selected":
                    raise Problem("Each decision must select a survey for this exact job")
                survey = self._record(db, selection["survey_id"], "surveys")
                if survey["id"] in observed_surveys:
                    raise Problem("The same survey row cannot be weighted twice")
                observed_surveys.add(survey["id"])
                line = {"selection": selection, "survey": survey, "errors": []}
                if source_mode == "current" and not self._is_current(db, survey):
                    line["errors"].append("Survey source has a newer imported edition")
                data = survey["record"]
                try:
                    currency = required(data.get("currency"), "currency", 10).upper()
                    currencies.add(currency)
                    multiplier, unit_basis = self._annual_multiplier(data)
                    effective = iso_date(data.get("effective_date"), "survey effective date", True)
                    mode = selection["aging_mode"]
                    age_factor = Decimal(1)
                    days = None
                    if target:
                        if not effective:
                            raise Problem("Survey effective date is required for the selected target date")
                        days = (target - effective).days
                        if mode == "none" and days != 0:
                            raise Problem("Select explicit aging for a source date different from the target date")
                    if mode != "none":
                        if not target or not effective:
                            raise Problem("Aging requires both original effective and target dates")
                        years = Decimal(days) / dec(selection["day_basis"])
                        rate = dec(selection["aging_rate_pct"]) / Decimal(100)
                        age_factor = 1 + rate * years if mode == "linear" else (1 + rate) ** years
                        if not age_factor.is_finite() or age_factor <= 0:
                            raise Problem("Selected aging produces a nonpositive/nonfinite factor")
                    scope_factor = 1 + dec(selection["scope_adjustment_pct"]) / Decimal(100)
                    amounts = {k: dec(data.get(k), k, True) for k in ("p25", "p50", "p75")}
                    if amounts["p50"] is None:
                        raise Problem("The selected survey does not supply a median figure")
                    source = json.loads(db.execute("SELECT document FROM imports WHERE id=?", (survey["source_id"],)).fetchone()[0])
                    minimum = source.get("metadata", {}).get("minimum_organizations")
                    if minimum not in (None, ""):
                        count = dec(data.get("organizations"), "reported organization count", True)
                        threshold = dec(minimum, "provider minimum organizations")
                        if count is None or count < threshold:
                            raise Problem("The recorded provider organization-count condition is not met")
                    adjusted = {k: ds(v * multiplier * age_factor * scope_factor) if v is not None else None for k, v in amounts.items()}
                    line.update({"currency": currency, "unit_basis": unit_basis, "effective_date": effective.isoformat() if effective else None, "target_date": target.isoformat() if target else None, "age_days": days, "aging_factor": ds(age_factor), "scope_factor": ds(scope_factor), "annualized_adjusted": adjusted, "source_use": source.get("metadata", {}).get("permitted_use", "")})
                except (Problem, InvalidOperation, OverflowError) as exc:
                    line["errors"].append(str(exc))
                errors.extend(survey["record_key"] + ": " + e for e in line["errors"])
                lines.append(line)
            if len(currencies) > 1:
                errors.append("Selected currencies differ; provide a single agreed currency source basis")
            totals, coverage = {}, {}
            for name in ("p25", "p50", "p75"):
                eligible = [line for line in lines if not line["errors"] and line.get("annualized_adjusted", {}).get(name) is not None]
                if len(eligible) != len(lines) or len(currencies) != 1:
                    totals[name] = None
                    coverage[name] = {"available": len(eligible), "selected": len(lines)}
                    if name != "p50" and len(eligible) != len(lines):
                        warnings.append(name + " is unavailable for one or more selected sources; consensus withheld for this measure")
                else:
                    weight = sum(dec(line["selection"]["weight"]) for line in eligible)
                    totals[name] = ds(sum(dec(line["annualized_adjusted"][name]) * dec(line["selection"]["weight"]) for line in eligible) / weight)
                    coverage[name] = {"available": len(eligible), "selected": len(lines), "total_weight": ds(weight)}
            reference, ratios = None, {}
            if job["record"].get("reference_amount") not in (None, ""):
                try:
                    multiplier, unit_basis = self._annual_multiplier(job["record"])
                    if len(currencies) != 1 or job["record"].get("currency", "").upper() not in currencies:
                        raise Problem("Job reference amount and survey currency differ")
                    reference = {"annual_amount": ds(dec(job["record"]["reference_amount"]) * multiplier), "unit_basis": unit_basis}
                    for name, amount in totals.items():
                        ratios[name] = ds(dec(reference["annual_amount"]) / dec(amount) * 100) if amount is not None and dec(amount) != 0 else None
                except Problem as exc:
                    errors.append("Job reference: " + str(exc))
        document = {"schema": "market.analysis.v1", "id": "analysis-" + uuid.uuid4().hex, "title": title, "created_at": now(), "source_revision": revision - 1, "job": job, "target_date": target.isoformat() if target else None, "basis_note": basis, "source_mode": source_mode, "method": "Weighted arithmetic consensus of selected published percentile figures; not pooled population percentiles", "lines": lines, "currency": next(iter(currencies)) if len(currencies) == 1 else None, "consensus": totals, "measure_coverage": coverage, "reference": reference, "reference_percent_of_consensus": ratios, "errors": errors, "warnings": list(dict.fromkeys(warnings)), "status": "CORRECTION_REQUIRED" if errors else "READY_FOR_REVIEW"}
        document["job_disposition"] = job_review
        document["receiving_origin"] = receiving_origin
        document["result_sha256"] = digest(document)
        db.execute("INSERT INTO analyses VALUES(?,?,?,?)", (document["id"], job["id"], document["created_at"], stable(document)))
        return document

    def _review(self, db, args, revision):
        row = db.execute("SELECT document FROM analyses WHERE id=?", (args.get("analysis_id"),)).fetchone()
        if not row:
            raise Problem("Analysis is absent", 404, "ANALYSIS_MISSING")
        analysis = json.loads(row[0])
        if args.get("result_sha256") != analysis["result_sha256"]:
            raise Problem("Review must bind the exact displayed analysis", 409, "REVIEW_CONFLICT")
        outcome = args.get("outcome")
        if outcome not in {"accepted", "changes_requested"}:
            raise Problem("Review outcome must be accepted or changes_requested")
        if outcome == "accepted" and analysis["errors"]:
            raise Problem("Resolve the analysis errors in a new retained analysis before acceptance")
        doc = {"id": "review-" + uuid.uuid4().hex, "analysis_id": analysis["id"], "result_sha256": analysis["result_sha256"], "reviewer": required(args.get("reviewer"), "reviewer", 300), "outcome": outcome, "notes": required(args.get("notes"), "review notes"), "created_at": now()}
        db.execute("INSERT INTO reviews VALUES(?,?,?,?)", (doc["id"], doc["analysis_id"], doc["created_at"], stable(doc)))
        return doc

    def _cycle(self, db, args, revision):
        doc = args.get("cycle")
        if not isinstance(doc, dict):
            raise Problem("cycle must be an object")
        doc = dict(doc)
        cycle_id = doc.get("id") or "cycle-" + uuid.uuid4().hex
        existing = db.execute("SELECT document FROM cycles WHERE id=?", (cycle_id,)).fetchone()
        if doc.get("id") and not existing:
            raise Problem("Cycle is absent", 404, "CYCLE_MISSING")
        doc["id"] = cycle_id
        doc["title"] = required(doc.get("title"), "cycle title", 500)
        doc["owner"] = required(doc.get("owner"), "cycle owner", 300)
        iso_date(doc.get("due_date"), "cycle due date", True)
        participants = doc.get("participants", [])
        if not isinstance(participants, list):
            raise Problem("Cycle participants must be a list")
        keys = set()
        for participant in participants:
            key = required(participant.get("peer_id"), "participant peer_id", 300)
            self._record(db, key, "peers")
            if key in keys:
                raise Problem("Duplicate cycle participant")
            keys.add(key)
            if participant.get("status") not in {"planned", "invited", "received", "reviewed", "declined", "outstanding"}:
                raise Problem("Unknown participant status")
            for source_id in participant.get("source_ids", []):
                if not db.execute("SELECT 1 FROM imports WHERE id=? AND status='IMPORTED'", (source_id,)).fetchone():
                    raise Problem("Participant source must identify an imported original edition")
            if participant.get("status") in {"received", "reviewed"} and not participant.get("source_ids"):
                raise Problem("A received/reviewed participant needs its original source edition")
        if doc.get("status", "open") not in {"open", "closed"}:
            raise Problem("Cycle status must be open or closed")
        if doc.get("status") == "closed":
            if any(p["status"] not in {"reviewed", "declined"} for p in participants):
                raise Problem("Resolve each participant before closing the cycle")
            required(doc.get("close_notes"), "cycle close notes")
        doc["created_at"] = json.loads(existing[0])["created_at"] if existing else now()
        doc["updated_at"] = now()
        doc["revision"] = revision
        db.execute("INSERT INTO cycles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,document=excluded.document", (cycle_id, doc["updated_at"], stable(doc)))
        return doc

    def _prepare_backup(self, db, args, revision):
        return {"id": "backup-" + uuid.uuid4().hex, "prepared_at": now(), "prepared_revision": revision, "scope": "Complete private workspace, including original uploaded sources and retained decisions"}

    def state(self):
        db = self.connect()
        try:
            imports = []
            for row in db.execute("SELECT * FROM imports ORDER BY created_at DESC"):
                doc = json.loads(row["document"])
                imports.append({k: doc[k] for k in ("id", "kind", "source_key", "source_name", "edition", "filename", "bytes", "raw_sha256", "created_at", "row_count", "metadata")} | {"status": row["status"], "errors": len(doc["errors"]), "imported_revision": row["imported_revision"]})
            selections = []
            for row in db.execute("SELECT document FROM selections ORDER BY created_at DESC"):
                doc = json.loads(row[0])
                job = self._record(db, doc["job_id"])
                survey = self._record(db, doc["survey_id"])
                doc["current"] = self._is_current(db, job) and self._is_current(db, survey)
                doc.update({"job_title": job["record"]["title"], "survey_title": survey["record"]["job_title"], "survey_source_name": survey["source_name"], "survey_edition": survey["edition"]})
                selections.append(doc)
            analyses = []
            for row in db.execute("SELECT document FROM analyses ORDER BY created_at DESC"):
                a = json.loads(row[0])
                reviews = [json.loads(r[0]) for r in db.execute("SELECT document FROM reviews WHERE analysis_id=? ORDER BY created_at DESC", (a["id"],))]
                analyses.append({k: a[k] for k in ("id", "title", "created_at", "result_sha256", "status", "currency", "consensus", "target_date", "errors", "warnings")} | {"job_id": a["job"]["id"], "job_title": a["job"]["record"]["title"], "latest_review": reviews[0] if reviews else None})
            job_reviews = [json.loads(r[0]) for r in db.execute("SELECT document FROM job_reviews ORDER BY created_at DESC")] if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_reviews'").fetchone() else []
            return {"workspace": self.meta(db), "fields": FIELDS, "sources": imports, "selections": selections, "job_reviews": job_reviews, "analyses": analyses, "cycles": [json.loads(r[0]) for r in db.execute("SELECT document FROM cycles ORDER BY updated_at DESC")], "counts": {k: db.execute("SELECT COUNT(*) FROM records WHERE kind=?", (k,)).fetchone()[0] for k in FIELDS}}
        finally:
            db.close()

    def records(self, kind, query="", offset=0, limit=100, current=True, source_id=None, publisher_scope=None):
        if kind not in FIELDS or offset < 0 or limit < 1 or limit > 500:
            raise Problem("Invalid record page")
        db = self.connect()
        try:
            where, params = ["r.kind=?"], [kind]
            if current:
                where.append("i.imported_revision=(SELECT MAX(i2.imported_revision) FROM imports i2 WHERE i2.source_key=i.source_key AND i2.status='IMPORTED')")
            if source_id:
                where.append("r.import_id=?")
                params.append(source_id)
            if publisher_scope is not None:
                if kind != "surveys":
                    raise Problem("A reviewed publisher group contains survey records")
                _, identities = self._publisher_scope(db, publisher_scope)
                where.append("r.id IN (SELECT value FROM json_each(?))")
                params.append(stable(identities))
            if query:
                where.append("r.document LIKE ? ESCAPE '\\'")
                params.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
            clause = " FROM records r JOIN imports i ON r.import_id=i.id WHERE " + " AND ".join(where)
            total = db.execute("SELECT COUNT(*)" + clause, params).fetchone()[0]
            rows = db.execute("SELECT r.document" + clause + " ORDER BY r.record_key LIMIT ? OFFSET ?", [*params, limit, offset])
            return {"items": [json.loads(r[0]) for r in rows], "total": total, "offset": offset, "limit": limit, "revision": self.meta(db)["revision"]}
        finally:
            db.close()

    def source_rows(self, identity, offset=0, limit=30):
        if type(offset) is not int or type(limit) is not int or offset < 0 or limit < 1 or limit > 500:
            raise Problem("Invalid source row page")
        source = self.document("source", identity)
        return {"source_id": identity, "items": source["records"][offset:offset + limit], "offset": offset, "limit": limit, "total": source["row_count"], "errors": len(source["errors"])}

    def document(self, kind, identity):
        table = {"analysis": "analyses", "source": "imports", "record": "records", "cycle": "cycles"}.get(kind)
        if not table:
            raise Problem("Unknown document type", 404)
        db = self.connect()
        try:
            row = db.execute("SELECT document FROM " + table + " WHERE id=?", (identity,)).fetchone()
            if not row:
                raise Problem("Document is absent", 404, "DOCUMENT_MISSING")
            doc = json.loads(row[0])
            if kind == "analysis":
                doc["reviews"] = [json.loads(r[0]) for r in db.execute("SELECT document FROM reviews WHERE analysis_id=? ORDER BY created_at", (identity,))]
            return doc
        finally:
            db.close()

    def report(self, analysis_id, fmt="json"):
        a = self.document("analysis", analysis_id)
        if not a["reviews"] or a["reviews"][-1]["outcome"] != "accepted":
            raise Problem("Save the receiving review before exporting its accepted report", 409, "REVIEW_REQUIRED")
        if fmt == "json":
            return (json.dumps(a, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
        if fmt != "csv":
            raise Problem("Report format must be csv or json")
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["analysis_id", "job_id", "job_title", "currency", "target_date", "basis", "measure", "weighted_consensus", "reference_annual", "reference_percent", "selected_sources", "reviewer", "review_notes", "result_sha256"])
        for measure, value in a["consensus"].items():
            values = [a["id"], a["job"]["record_key"], a["job"]["record"]["title"], a["currency"], a["target_date"], a["basis_note"], measure, value, (a.get("reference") or {}).get("annual_amount"), a["reference_percent_of_consensus"].get(measure), "; ".join(line["survey"]["source_name"] + " / " + line["survey"]["record_key"] for line in a["lines"]), a["reviews"][-1]["reviewer"], a["reviews"][-1]["notes"], a["result_sha256"]]
            writer.writerow([("'" + str(v)) if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v for v in values])
        return stream.getvalue().encode("utf-8-sig")

    def backup(self, backup_id):
        if not re.fullmatch(r"backup-[a-f0-9]{32}", backup_id):
            raise Problem("Unknown backup ID")
        db = self.connect()
        try:
            found = any(json.loads(r[0]).get("id") == backup_id for r in db.execute("SELECT result FROM operations WHERE action='prepare_backup'"))
            if not found:
                raise Problem("Prepare this backup through the original operation first", 404)
        finally:
            db.close()
        directory = self.root / "exports"
        directory.mkdir(exist_ok=True, mode=0o700)
        target = directory / (backup_id + ".zip")
        import fcntl
        with (directory / (backup_id + ".lock")).open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            if target.exists():
                return target
            snapshot = directory / (backup_id + ".sqlite3")
            if not snapshot.exists():
                temporary = directory / (backup_id + ".sqlite3.part")
                source, destination = self.connect(), sqlite3.connect(temporary)
                try:
                    source.backup(destination)
                    if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise Problem("Native snapshot is inconsistent", 500)
                finally:
                    source.close()
                    destination.close()
                with temporary.open("rb") as f:
                    os.fsync(f.fileno())
                os.replace(temporary, snapshot)
            check = sqlite3.connect(snapshot)
            try:
                metadata = {k: json.loads(v) for k, v in check.execute("SELECT key,value FROM meta")}
            finally:
                check.close()
            manifest = {"schema": "market.workspace-backup.v1", "backup_id": backup_id, "created_at": now(), "workspace": metadata, "files": [{"path": "workspace.sqlite3", "bytes": snapshot.stat().st_size, "sha256": file_digest(snapshot)}]}
            part = directory / (backup_id + ".zip.part")
            with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED) as z:
                z.write(snapshot, "workspace.sqlite3")
                z.writestr("MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
            with zipfile.ZipFile(part) as z:
                if z.testzip() is not None:
                    raise Problem("Saved archive failed native CRC reading", 500)
            with part.open("rb") as f:
                os.fsync(f.fileno())
            os.replace(part, target)
            snapshot.unlink()
            return target


def archive_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def check_archive_source(package, handle, identity):
    if archive_identity(os.fstat(handle.fileno())) != identity or archive_identity(package.stat()) != identity:
        raise Problem("The original archive changed during receiving; preserve it and resume the same source", 409, "ARCHIVE_CHANGED")


def restore(package, directory):
    package = Path(package).expanduser().resolve()
    with package.open("rb") as handle:
        identity = archive_identity(os.fstat(handle.fileno()))
        if identity[2] > 512 * 1024 * 1024:
            raise Problem("Workspace archive exceeds 512 MiB")
        sha = hashlib.sha256()
        for part in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(part)
        handle.seek(0)
        check_archive_source(package, handle, identity)
        return restore_archive(package, handle, identity, sha.hexdigest(), directory)


def restore_archive(package, handle, identity, source_hash, directory):
    import fcntl
    root = Path(directory).expanduser().resolve()
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = root.parent / (".market-restore-" + hashlib.sha256(str(root).encode()).hexdigest() + ".lock")
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(lock_path, flags, 0o600), "a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        check_archive_source(package, handle, identity)
        return _restore_archive_locked(package, handle, identity, source_hash, root)


def _restore_archive_locked(package, handle, identity, source_hash, directory):
    root = Path(directory).expanduser().resolve()
    marker_path = root / "RESTORE.json"
    marker = None
    if root.exists():
        if not root.is_dir():
            raise Problem("Receiving target must be a directory", 409)
        if marker_path.is_file():
            try:
                marker = strict_json(marker_path.read_text(encoding="utf-8"))
            except (Problem, UnicodeError):
                marker = None
            if marker is not None and not isinstance(marker, dict):
                marker = None
            if marker is not None:
                if marker.get("source_sha256") != source_hash:
                    raise Problem("This receiving directory belongs to a different archive", 409)
                if marker.get("status") == "complete":
                    current = Workspace(root).state()["workspace"]
                    if current["id"] != marker.get("workspace_id"):
                        raise Problem("The completed receiving workspace identity changed", 409)
                    check_archive_source(package, handle, identity)
                    return {"replayed": True, "workspace": current, "directory": str(root), "source_sha256": source_hash}
    with zipfile.ZipFile(handle) as z:
        if sorted(z.namelist()) != ["MANIFEST.json", "workspace.sqlite3"]:
            raise Problem("Archive member roster differs from the native format")
        if z.getinfo("MANIFEST.json").file_size > 1024 * 1024:
            raise Problem("Native workspace manifest is unexpectedly large")
        manifest = strict_json(z.read("MANIFEST.json").decode())
        if manifest.get("schema") != "market.workspace-backup.v1" or len(manifest.get("files", [])) != 1:
            raise Problem("Unknown workspace manifest")
        item = manifest["files"][0]
        if item.get("path") != "workspace.sqlite3" or type(item.get("bytes")) is not int or not 0 < item["bytes"] <= 512 * 1024 * 1024 or not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))):
            raise Problem("Invalid native database manifest")
        info = z.getinfo("workspace.sqlite3")
        if info.file_size != item["bytes"]:
            raise Problem("Database byte count differs from the manifest")
        partial = root / "workspace.sqlite3.part"
        target = root / "workspace.sqlite3"
        if marker is None:
            if root.exists():
                known = {"RESTORE.json", "RESTORE.json.part", "workspace.sqlite3"}
                if any(p.name not in known or not p.is_file() or p.is_symlink() for p in root.iterdir()):
                    raise Problem("Restore requires a fresh directory or its retained original receiving identity", 409)
                if target.exists() and (target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]):
                    raise Problem("The receiving database does not match this original archive", 409)
                pending_marker = root / "RESTORE.json.part"
                if pending_marker.is_file():
                    try:
                        pending = strict_json(pending_marker.read_text(encoding="utf-8"))
                    except (Problem, UnicodeError):
                        pending = None
                    if isinstance(pending, dict) and pending.get("source_sha256") not in (None, source_hash):
                        raise Problem("An interrupted receiving marker belongs to another archive", 409)
            else:
                root.mkdir(parents=True, mode=0o700)
            marker = {"schema": 1, "source_sha256": source_hash, "status": "receiving", "started_at": now()}
            atomic_json(marker_path, marker)
        if target.exists():
            if file_digest(target) != item["sha256"]:
                raise Problem("Existing receiving database differs from the original snapshot", 409)
        else:
            with z.open("workspace.sqlite3") as source, partial.open("wb") as output:
                for part in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(part)
                output.flush()
                os.fsync(output.fileno())
            if file_digest(partial) != item["sha256"]:
                raise Problem("Original database hash does not match")
        candidate = target if target.exists() else partial
        check = sqlite3.connect(candidate)
        try:
            if check.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise Problem("Restored SQLite data is inconsistent")
            metadata = {k: json.loads(v) for k, v in check.execute("SELECT key,value FROM meta")}
            if metadata.get("schema") != SCHEMA or metadata != manifest["workspace"]:
                raise Problem("Restored workspace identity differs from its manifest")
            if check.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise Problem("Restored source references are inconsistent")
        finally:
            check.close()
        check_archive_source(package, handle, identity)
        if candidate == partial:
            os.replace(partial, target)
            os.chmod(target, 0o600)
    marker.update({"status": "complete", "completed_at": now(), "workspace_id": manifest["workspace"]["id"]})
    atomic_json(marker_path, marker)
    check_archive_source(package, handle, identity)
    return {"replayed": False, "workspace": Workspace(root).state()["workspace"], "directory": str(root), "source_sha256": source_hash}
