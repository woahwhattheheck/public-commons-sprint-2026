#!/usr/bin/env python3
"""Customer-side receiving for the original complete Databento delivery.

No acquisition, provider calls, migration inference, or producer state mutation.
Values are retained as original JSON bytes and exact-text warehouse columns.
"""
from __future__ import annotations

import argparse
import csv
import fcntl
import hashlib
import html
import io
import json
import os
import re
import shutil
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "tj.databento-customer-warehouse.v1"
DELIVERY = "tj.databento-migration-delivery.v1"
APPLICATION_ID = 0x44425748
BATCH = 512
MAX_ROW_BYTES = 16 * 1024 * 1024
MAX_METADATA_BYTES = 32 * 1024 * 1024
HASH = re.compile(r"^[0-9a-f]{64}$")
SMALL = (
    "customer/migration-summary.json",
    "customer/migration-summary.html",
    "customer/source-index.json",
    "customer/output-columns.json",
    "customer/DELIVERY.md",
)
DATA_JSON = "customer/mapped-records.ndjson"
DATA_CSV = "customer/mapped-records.csv"


class ReceivingError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(value, code, message):
    if not value:
        raise ReceivingError(code, message)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def sha(value):
    return hashlib.sha256(value).hexdigest()


class NumberLexeme(str):
    """A JSON number's original token, distinct from a JSON string."""


def unique_pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "DUPLICATE_KEY", "Repeated JSON key: " + repr(key))
        result[key] = value
    return result


def parse_exact(value):
    return json.loads(
        value, parse_int=NumberLexeme, parse_float=NumberLexeme,
        parse_constant=lambda x: (_ for _ in ()).throw(ReceivingError("JSON_NUMBER", x)),
        object_pairs_hook=unique_pairs,
    )


def dump_exact(value):
    if isinstance(value, NumberLexeme):
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(dump_exact(x) for x in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + dump_exact(v)
                              for k, v in value.items()) + "}"
    raise ReceivingError("JSON_VALUE", "Unsupported exact JSON value.")


def cell(value):
    if value is None:
        return None, "null"
    if isinstance(value, NumberLexeme):
        return str(value), "number"
    if isinstance(value, str):
        return value, "string"
    if isinstance(value, bool):
        return "true" if value else "false", "boolean"
    if isinstance(value, dict):
        return dump_exact(value), "object"
    if isinstance(value, list):
        return dump_exact(value), "array"
    raise ReceivingError("JSON_VALUE", "Unsupported cell type.")


def csv_value(value):
    text, kind = cell(value)
    return "" if kind == "null" else text


def regular_file(root, relative):
    require(isinstance(relative, str) and relative and "\\" not in relative
            and "\x00" not in relative, "FILE_PATH", "Use a nonempty POSIX relative path.")
    parts = relative.split("/")
    require(all(p not in ("", ".", "..") for p in parts)
            and not Path(relative).is_absolute(), "FILE_PATH", "Delivery paths must stay below their directory.")
    current = root
    for part in parts:
        current = current / part
        require(not current.is_symlink(), "FILE_SYMLINK", "A delivery member is a symbolic link: " + relative)
    require(current.is_file() and current.resolve().is_relative_to(root.resolve()),
            "FILE_MISSING", "Missing delivery member: " + relative)
    return current


def identity(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return {"bytes": size, "sha256": digest.hexdigest()}


def verify_member(root, entry):
    p = regular_file(root, entry["path"])
    actual = identity(p)
    require(actual["bytes"] == entry["bytes"] and actual["sha256"] == entry["sha256"],
            "FILE_IDENTITY", "Delivery member differs from its original manifest: " + entry["path"])
    return p


def read_metadata(path, entry=None):
    require(path.stat().st_size <= MAX_METADATA_BYTES, "METADATA_SIZE",
            "Metadata exceeds the supported 32 MiB limit; row data belongs in the streaming members.")
    body = path.read_bytes()
    require(len(body) <= MAX_METADATA_BYTES, "METADATA_SIZE", "Metadata grew beyond the supported limit while reading.")
    if entry:
        require(len(body) == entry["bytes"] and sha(body) == entry["sha256"],
                "FILE_CHANGED", "Metadata changed during receiving.")
    return body


def metadata_document(body, code):
    value = json.loads(body, object_pairs_hook=unique_pairs,
                       parse_constant=lambda value: (_ for _ in ()).throw(ReceivingError(code, "Nonfinite metadata number: " + value)))
    require(isinstance(value, dict), code, "A JSON object is required.")
    return value


def read_delivery(directory):
    root = Path(directory).resolve()
    require(root.is_dir(), "DELIVERY_DIRECTORY", "Select the original complete delivery directory.")
    original = read_metadata(regular_file(root, "manifest.json"))
    manifest = metadata_document(original, "DELIVERY_SCHEMA")
    require(manifest.get("schema") == DELIVERY, "DELIVERY_SCHEMA", "Select the original migration delivery manifest.")
    require(manifest.get("audience") in ("customer", "operator"), "DELIVERY_AUDIENCE", "Unknown original audience.")
    require(manifest.get("allSelectedRecordsProcessed") is True, "INCOMPLETE_DELIVERY",
            "The original processor has not marked all selected records as processed.")
    require(isinstance(manifest.get("editionId"), str) and manifest["editionId"],
            "EDITION_ID", "The original edition identity is required.")
    require(HASH.fullmatch(str(manifest.get("workspaceSha256", ""))), "WORKSPACE_ID", "The original workspace hash is required.")
    for key in ("processedRecords", "primaryRecords", "customerRecords", "excludedRecords"):
        require(type(manifest.get(key)) is int and manifest[key] >= 0, "RECORD_COUNT", "Invalid original count: " + key)
    require(manifest["customerRecords"] + manifest["excludedRecords"] == manifest["primaryRecords"]
            and manifest["processedRecords"] >= manifest["primaryRecords"],
            "RECORD_COUNT", "Original primary/customer/excluded counts disagree.")
    require(isinstance(manifest.get("sources"), list)
            and isinstance(manifest.get("sourceCoverage"), (dict, list)), "SOURCE_COVERAGE", "Retain the original source coverage.")
    entries = {}
    require(isinstance(manifest.get("files"), list), "DELIVERY_FILES", "The complete file inventory is required.")
    for entry in manifest["files"]:
        require(isinstance(entry, dict) and isinstance(entry.get("path"), str)
                and entry["path"] not in entries, "DELIVERY_FILES", "File identities must be unique.")
        require(type(entry.get("bytes")) is int and entry["bytes"] >= 0
                and HASH.fullmatch(str(entry.get("sha256", ""))), "DELIVERY_FILES", "Invalid file size or digest.")
        regular_file(root, entry["path"])
        entries[entry["path"]] = entry
    for name in (*SMALL, DATA_JSON, DATA_CSV):
        require(name in entries, "CUSTOMER_FILES", "Missing original complete customer member: " + name)
    # Verify every listed file, including operator members that will not be retained.
    for entry in entries.values():
        verify_member(root, entry)
    small = {name: read_metadata(regular_file(root, name), entries[name]) for name in SMALL}
    column_document = metadata_document(small["customer/output-columns.json"], "COLUMNS_SCHEMA")
    require(column_document.get("schema") == "tj.databento-output-columns.v1", "COLUMNS_SCHEMA", "Unexpected original columns document.")
    columns = column_document.get("columns")
    require(isinstance(columns, list) and columns, "COLUMNS", "A nonempty original column mapping is required.")
    names = []
    for index, column in enumerate(columns):
        require(isinstance(column, dict) and isinstance(column.get("name"), str)
                and column["name"].strip() and column["name"] not in names
                and isinstance(column.get("path"), str), "COLUMNS", "Original names must be unique and pointer mappings must be explicit.")
        names.append(column["name"])
    summary = metadata_document(small["customer/migration-summary.json"], "CUSTOMER_METADATA")
    source_index = metadata_document(small["customer/source-index.json"], "CUSTOMER_METADATA")
    require(summary.get("schema") == "tj.databento-migration-report.v1"
            and source_index.get("schema") == "tj.databento-source-index.v1"
            and source_index.get("editionId") == manifest["editionId"],
            "CUSTOMER_METADATA", "Customer metadata does not identify this original edition.")
    require(isinstance(summary.get("edition"), dict)
            and summary["edition"].get("id") == manifest["editionId"]
            and summary.get("outputColumns") == columns
            and source_index.get("sources") == manifest["sources"]
            and source_index.get("coverage") == manifest["sourceCoverage"]
            and summary.get("coverage") == manifest["sourceCoverage"],
            "CUSTOMER_METADATA_BINDING", "Customer source identities, coverage, edition or output columns disagree with the complete manifest.")
    counts = summary.get("summary")
    require(isinstance(counts, dict)
            and all(type(counts.get(report_key)) is int and counts[report_key] == manifest[manifest_key]
                    for report_key, manifest_key in (
                        ("totalRecords", "processedRecords"), ("primaryRecords", "primaryRecords"),
                        ("customerRecords", "customerRecords"), ("excludedPrimaryRecords", "excludedRecords"))),
            "CUSTOMER_METADATA_COUNTS", "The original customer report and manifest counts disagree.")
    require(isinstance(summary.get("dataExport"), dict)
            and summary["dataExport"].get("included") is True
            and type(manifest.get("assessmentReady")) is bool
            and summary.get("ready") is manifest["assessmentReady"],
            "CUSTOMER_METADATA_ASSESSMENT", "Retain the complete original data-export and assessment result without changing its meaning.")
    return {"root": root, "manifest": manifest, "original": original,
            "id": "delivery-" + sha(original), "entries": entries,
            "small": small, "columns": columns, "summary": summary}


class HashedReader(io.RawIOBase):
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()
        self.size = 0

    def readable(self):
        return True

    def readinto(self, target):
        data = self.stream.read(len(target))
        target[:len(data)] = data
        self.digest.update(data)
        self.size += len(data)
        return len(data)


def connect(path, readonly=False):
    if readonly:
        db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, isolation_level=None, timeout=10)
    else:
        db = sqlite3.connect(path, isolation_level=None, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    db.execute("PRAGMA busy_timeout=10000")
    if readonly:
        db.execute("PRAGMA query_only=ON")
    else:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA journal_mode=DELETE")
    return db


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def table_for(delivery_id):
    require(isinstance(delivery_id, str) and delivery_id.startswith("delivery-")
            and HASH.fullmatch(delivery_id[9:]), "DELIVERY_ID", "Use a retained delivery identity.")
    return "records_" + delivery_id[9:]


def fsync_file(path):
    with path.open("rb") as stream:
        os.fsync(stream.fileno())


def new_directory(path):
    p = Path(path).absolute()
    require(p.parent.is_dir(), "DESTINATION_PARENT", "The destination parent must already exist.")
    try:
        p.mkdir(mode=0o700)
    except FileExistsError:
        raise ReceivingError("DESTINATION_EXISTS", "Choose a new destination; existing content is preserved.")
    return p


def render_overview(inspection, page, receipt, decisions):
    """Render a portable customer reading view from retained, escaped values."""
    esc = lambda value: html.escape("" if value is None else str(value), quote=True)
    manifest = inspection["originalManifest"]
    title = "Databento customer receiving"
    facts = [
        ("Received edition", manifest["editionId"]),
        ("Selection", receipt["selection"]),
        ("Selected records", receipt["selectedRecords"]),
        ("Original customer records", manifest["customerRecords"]),
        ("Original excluded primary records", manifest["excludedRecords"]),
        ("Customer head generation at export", receipt["headAtExport"]["generation"]),
        ("Original assessment ready", manifest["assessmentReady"]),
    ]
    facts_html = "".join("<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>" for k, v in facts)
    columns = "".join("<th scope=\"col\">" + esc(c["name"]) + "<small>" + esc(c["path"]) + "</small></th>"
                      for c in page["columns"])
    rows = []
    for item in page["items"]:
        cells = "".join("<td title=\"" + esc(c["kind"]) + "\"><span class=\"kind\">" + esc(c["kind"]) +
                        "</span><span class=\"value\">" + ("null" if c["kind"] == "null" else esc(c["text"])) +
                        "</span></td>" for c in item["cells"])
        rows.append("<tr><th scope=\"row\">" + esc(item["ordinal"]) + "</th>" + cells + "</tr>")
    if not rows:
        rows.append("<tr><td colspan=\"" + str(len(page["columns"]) + 1) + "\">No records match this selection.</td></tr>")
    sources = "".join(
        "<li><strong>" + esc(x.get("id", "")) + "</strong><span>" +
        esc(" / ".join(str(x.get(k, "")) for k in ("role", "kind", "dataset", "schema"))) +
        "</span><code>" + esc(x.get("sha256", "")) + "</code></li>"
        for x in manifest["sources"])
    decisions_html = "".join("<li><strong>Generation " + esc(x["generation"]) + " · " + esc(x["kind"]) +
                             "</strong><span>" + esc(x["actor"]) + " · " + esc(x["at"]) +
                             "</span><p>" + esc(x["reason"]) + "</p><code>" +
                             esc(x["deliveryId"]) + "</code></li>" for x in decisions)
    if not decisions_html:
        decisions_html = "<li>No customer activation or rollback decision involves this staged delivery.</li>"
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'\">"
            "<title>" + title + "</title><style>"
            "*{box-sizing:border-box}body{margin:0;background:#f6f6f6;color:#202020;font:15px/1.5 system-ui,sans-serif}"
            "main{max-width:1280px;margin:auto;padding:28px}h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:24px 0 10px}"
            "section{padding:20px;border:1px solid #c7c7c7;background:#fff;margin:16px 0}p{margin:8px 0}"
            "a{color:#202020;text-underline-offset:3px}nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin:18px 0}"
            "dl{display:grid;grid-template-columns:minmax(170px,1fr) 2fr;gap:5px 20px;margin:0}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}"
            "code,.value{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}"
            "code{display:block}small,.kind{display:block;color:#666;font-size:11px;font-weight:400}"
            ".table-scroll{overflow:auto;max-width:100%;border:1px solid #bbb}table{border-collapse:collapse;min-width:100%;font-size:12px}"
            "th,td{text-align:left;vertical-align:top;border:1px solid #ddd;padding:9px;min-width:100px;max-width:280px}"
            "th{background:#eee}th:first-child{min-width:56px}ul{padding-left:22px}li{margin:10px 0}li>span{display:block}"
            ".muted{color:#555}.scope{border-left:3px solid #777;padding-left:12px}"
            "@media(max-width:600px){main{padding:12px}section{padding:14px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}h1{font-size:24px}}"
            "@media print{body{background:#fff}main{padding:0}section{break-inside:avoid}nav{display:none}.table-scroll{overflow:visible}table{font-size:9px}th,td{min-width:0;padding:4px}}"
            "</style></head><body><main><header><h1>" + title + "</h1>"
            "<p class=\"muted\">Customer warehouse export · " + esc(receipt["createdAt"]) + "</p></header>"
            "<nav><a href=\"customer/mapped-records.ndjson\">Exact JSON records</a>"
            "<a href=\"customer/mapped-records.csv\">CSV records</a>"
            "<a href=\"receiving-manifest.json\">Receiving manifest</a>"
            "<a href=\"receiving-decisions.json\">Customer decisions</a>"
            "<a href=\"provenance/original-manifest.json\">Original manifest</a></nav>"
            "<section><h2>Received selection</h2><dl>" + facts_html + "</dl>"
            "<p class=\"scope\">Source roles and coverage are retained. A reference session remains a reference session. "
            "Customer activation selects a local delivery; it does not establish a provider migration comparison or change the original assessment.</p>"
            "<p>Original manifest SHA256</p><code>" + esc(receipt["originalManifestSha256"]) +
            "</code><p>Original workspace SHA256</p><code>" + esc(receipt["originalWorkspaceSha256"]) +
            "</code><p>Exact filters</p><code>" + esc(dumps(receipt["filters"])) + "</code></section>"
            "<section><h2>Records</h2><p>Showing " + str(len(page["items"])) + " of " + str(receipt["selectedRecords"]) +
            " selected records. The linked files contain the entire selection. Values keep exact text and their JSON kinds; no numeric rounding is applied.</p>"
            "<div class=\"table-scroll\"><table><thead><tr><th scope=\"col\">Row</th>" + columns +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div></section>"
            "<section><h2>Source identities</h2><ul>" + sources + "</ul><h3>Original coverage</h3><code>" +
            esc(dumps(manifest["sourceCoverage"])) + "</code></section>"
            "<section><h2>Customer decisions involving this delivery</h2><ul>" + decisions_html +
            "</ul><p class=\"muted\">These are retained local customer decisions. Provider operator notes and private review files are excluded.</p></section>"
            "</main></body></html>")


class Warehouse:
    def __init__(self, directory, readonly=False):
        self.root = Path(directory).resolve()
        self.path = self.root / "warehouse.sqlite3"
        require(self.path.is_file() and not self.path.is_symlink(), "WAREHOUSE_MISSING", "Open an initialized receiving warehouse.")
        self.db = connect(self.path, readonly)
        require(self.db.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID,
                "WAREHOUSE_SCHEMA", "This is not a Databento customer warehouse.")
        row = self.db.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
        require(row and row[0] == SCHEMA, "WAREHOUSE_SCHEMA", "Unsupported warehouse schema.")
        self.readonly = readonly

    @classmethod
    def create(cls, directory):
        root = new_directory(directory)
        try:
            db = connect(root / "warehouse.sqlite3")
            db.execute("PRAGMA application_id=" + str(APPLICATION_ID))
            db.executescript("""
                CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE deliveries(
                    id TEXT PRIMARY KEY, manifest BLOB NOT NULL, manifest_sha TEXT NOT NULL,
                    edition_id TEXT NOT NULL, workspace_sha TEXT NOT NULL,
                    columns_json TEXT NOT NULL, state TEXT NOT NULL,
                    imported_rows INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
                    completed_at TEXT, last_error TEXT);
                CREATE TABLE documents(
                    delivery_id TEXT NOT NULL REFERENCES deliveries(id),
                    path TEXT NOT NULL, body BLOB NOT NULL, sha256 TEXT NOT NULL,
                    PRIMARY KEY(delivery_id,path));
                CREATE TABLE head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                    generation INTEGER NOT NULL, delivery_id TEXT REFERENCES deliveries(id));
                CREATE TABLE decisions(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT UNIQUE NOT NULL,
                    request_sha TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
                    reason TEXT NOT NULL, at TEXT NOT NULL, previous_id TEXT, delivery_id TEXT NOT NULL,
                    generation INTEGER NOT NULL, result_json TEXT NOT NULL);
                CREATE TABLE warehouse_indexes(
                    delivery_id TEXT NOT NULL, column_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL, PRIMARY KEY(delivery_id,column_index));
            """)
            with transaction(db):
                db.executemany("INSERT INTO metadata VALUES(?,?)",
                               [("schema", SCHEMA), ("created_at", now())])
                db.execute("INSERT INTO head VALUES(1,0,NULL)")
            db.close()
            os.chmod(root / "warehouse.sqlite3", 0o600)
            (root / "locks").mkdir(mode=0o700)
            return cls(root)
        except BaseException:
            shutil.rmtree(root)
            raise

    def close(self):
        self.db.close()

    def head(self):
        return dict(self.db.execute("SELECT generation,delivery_id FROM head WHERE singleton=1").fetchone())

    def _delivery(self, delivery_id=None, completed=True):
        delivery_id = delivery_id or self.head()["delivery_id"]
        require(delivery_id, "NO_ACTIVE_DELIVERY", "Select a retained delivery or activate one explicitly.")
        row = self.db.execute("SELECT * FROM deliveries WHERE id=?", (delivery_id,)).fetchone()
        require(row, "DELIVERY_UNKNOWN", "The selected delivery has not been received.")
        require(not completed or row["state"] == "staged", "DELIVERY_INCOMPLETE", "Receiving is incomplete; resume the exact original delivery.")
        return row

    def status(self):
        rows = self.db.execute(
            "SELECT id,edition_id,workspace_sha,state,imported_rows,received_at,completed_at,last_error FROM deliveries ORDER BY received_at,id"
        ).fetchall()
        return {"schema": SCHEMA, "head": self.head(), "deliveries": [dict(x) for x in rows],
                "decisions": [json.loads(x[0]) for x in self.db.execute("SELECT result_json FROM decisions ORDER BY sequence")]}

    def inspect(self, delivery_id=None):
        row = self._delivery(delivery_id, completed=False)
        manifest = json.loads(row["manifest"])
        columns = json.loads(row["columns_json"])
        return {"schema": "tj.databento-warehouse-inspection.v1", "id": row["id"],
                "state": row["state"], "importedRows": row["imported_rows"], "head": self.head(),
                "originalManifest": manifest, "originalManifestSha256": row["manifest_sha"],
                "columns": [{**x, "sqlColumn": "c" + str(i), "sqlKindColumn": "k" + str(i)}
                            for i, x in enumerate(columns)],
                "retainedFiles": [dict(x) for x in self.db.execute(
                    "SELECT path,sha256,length(body) AS bytes FROM documents WHERE delivery_id=? ORDER BY path", (row["id"],))],
                "sqlTable": table_for(row["id"]),
                "valueSemantics": "Exact text plus JSON kind; _raw holds the complete original NDJSON line.",
                "lastError": row["last_error"]}

    def receive(self, directory):
        require(not self.readonly, "READ_ONLY", "Open the warehouse for receiving.")
        delivery = read_delivery(directory)
        did, columns = delivery["id"], delivery["columns"]
        lock_root = self.root / "locks"
        lock_root.mkdir(mode=0o700, exist_ok=True)
        lock = (lock_root / (did + ".lock")).open("a+b")
        try:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ReceivingError("RECEIVING_BUSY", "Another process is receiving this exact delivery.")
            return self._receive_locked(delivery)
        finally:
            lock.close()

    def _receive_locked(self, d):
        did, columns, m = d["id"], d["columns"], d["manifest"]
        table = table_for(did)
        require(2 + 2 * len(columns) <= self.db.getlimit(sqlite3.SQLITE_LIMIT_COLUMN),
                "COLUMN_LIMIT", "This mapping exceeds the installed SQLite column limit; preserve it and choose a narrower customer mapping upstream.")
        prior = self.db.execute("SELECT * FROM deliveries WHERE id=?", (did,)).fetchone()
        if prior and prior["state"] == "staged":
            return {"reused": True, **self.inspect(did)}
        with transaction(self.db):
            if prior is None:
                self.db.execute(
                    "INSERT INTO deliveries(id,manifest,manifest_sha,edition_id,workspace_sha,columns_json,state,received_at) VALUES(?,?,?,?,?,?,'importing',?)",
                    (did, d["original"], sha(d["original"]), m["editionId"], m["workspaceSha256"], dumps(columns), now()))
                sql_columns = ",".join("c%d TEXT,k%d TEXT NOT NULL" % (i, i) for i in range(len(columns)))
                self.db.execute("CREATE TABLE " + table + "(_ordinal INTEGER PRIMARY KEY,_raw BLOB NOT NULL," + sql_columns + ")")
            else:
                require(bytes(prior["manifest"]) == d["original"] and prior["columns_json"] == dumps(columns),
                        "RESUME_IDENTITY", "The retained import does not match the exact original manifest and mapping.")
            for name, body in d["small"].items():
                self.db.execute("INSERT OR IGNORE INTO documents VALUES(?,?,?,?)", (did, name, body, sha(body)))
            self.db.execute("UPDATE deliveries SET last_error=NULL WHERE id=?", (did,))
        previous_count = self.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
        names = [x["name"] for x in columns]
        raw_path = regular_file(d["root"], DATA_JSON)
        csv_path = regular_file(d["root"], DATA_CSV)
        expected_json, expected_csv = d["entries"][DATA_JSON], d["entries"][DATA_CSV]
        digest = hashlib.sha256()
        consumed_bytes, count, batch = 0, 0, []
        placeholders = ",".join("?" for _ in range(2 + 2 * len(columns)))
        insert_sql = "INSERT INTO " + table + " VALUES(" + placeholders + ")"
        old_cursor = self.db.execute("SELECT _ordinal,_raw FROM " + table + " ORDER BY _ordinal")
        csv.field_size_limit(MAX_ROW_BYTES)
        try:
            with raw_path.open("rb") as raw, csv_path.open("rb") as raw_csv:
                checked_csv = HashedReader(raw_csv)
                csv_text = io.TextIOWrapper(io.BufferedReader(checked_csv), encoding="utf-8", newline="")
                reader = csv.reader(csv_text, strict=True)
                require(next(reader, None) == names, "CSV_HEADER", "Original CSV column labels or order differ from the mapping.")
                while True:
                    line = raw.readline(MAX_ROW_BYTES + 1)
                    if not line:
                        break
                    require(len(line) <= MAX_ROW_BYTES, "ROW_SIZE", "A mapped row exceeds the supported 16 MiB row limit.")
                    require(line.strip(), "EMPTY_ROW", "Mapped NDJSON contains an empty row.")
                    digest.update(line)
                    consumed_bytes += len(line)
                    obj = parse_exact(line)
                    require(isinstance(obj, dict) and set(obj) == set(names), "ROW_COLUMNS", "A mapped row does not match the exact selected columns.")
                    csv_row = next(reader, None)
                    require(csv_row is not None and csv_row == [csv_value(obj[name]) for name in names],
                            "CSV_JSON_DIFFERENCE", "CSV and exact JSON disagree at record " + str(count + 1))
                    count += 1
                    if count <= previous_count:
                        old = old_cursor.fetchone()
                        require(old is not None and old["_ordinal"] == count and bytes(old["_raw"]) == line,
                                "RESUME_ROW_IDENTITY", "A committed receiving prefix differs from the original delivery.")
                    else:
                        values = [count, line]
                        for name in names:
                            text, kind = cell(obj[name])
                            values.extend((text, kind))
                        batch.append(values)
                        if len(batch) >= BATCH:
                            with transaction(self.db):
                                self.db.executemany(insert_sql, batch)
                                self.db.execute("UPDATE deliveries SET imported_rows=? WHERE id=?", (count, did))
                            batch.clear()
                require(next(reader, None) is None, "CSV_EXTRA_ROWS", "CSV has more rows than the original NDJSON.")
                require(consumed_bytes == expected_json["bytes"] and digest.hexdigest() == expected_json["sha256"]
                        and checked_csv.size == expected_csv["bytes"] and checked_csv.digest.hexdigest() == expected_csv["sha256"],
                        "SOURCE_CHANGED", "A streamed data member changed during receiving.")
                require(count == m["customerRecords"] and count >= previous_count, "CUSTOMER_RECORD_COUNT", "Complete received count differs from the original manifest.")
                require(read_metadata(regular_file(d["root"], "manifest.json")) == d["original"],
                        "MANIFEST_CHANGED", "The original manifest changed during receiving.")
            with transaction(self.db):
                if batch:
                    self.db.executemany(insert_sql, batch)
                self.db.execute("UPDATE deliveries SET state='staged',imported_rows=?,completed_at=?,last_error=NULL WHERE id=?",
                                (count, now(), did))
            return {"reused": prior is not None, "resumedRows": previous_count, **self.inspect(did)}
        except BaseException as error:
            self.db.rollback()
            try:
                with transaction(self.db):
                    self.db.execute("UPDATE deliveries SET last_error=? WHERE id=?",
                                    (dumps({"code": getattr(error, "code", type(error).__name__), "message": str(error), "at": now()}), did))
            except sqlite3.Error:
                pass
            raise
        finally:
            old_cursor.close()

    def activate(self, delivery_id, generation, expected_delivery, actor, reason, operation_id, rollback=False):
        require(not self.readonly, "READ_ONLY", "Open the warehouse for an explicit customer decision.")
        require(all(isinstance(x, str) and x.strip() for x in (actor, reason, operation_id)),
                "DECISION_FIELDS", "A named actor, reason and stable operation ID are required.")
        require(type(generation) is int and generation >= 0, "HEAD_GENERATION", "Use the displayed head generation.")
        request = {"deliveryId": delivery_id, "expectedGeneration": generation, "expectedDelivery": expected_delivery,
                   "actor": actor, "reason": reason, "operationId": operation_id, "kind": "rollback" if rollback else "activate"}
        request_sha = sha(dumps(request).encode())
        with transaction(self.db):
            old = self.db.execute("SELECT request_sha,result_json FROM decisions WHERE operation_id=?", (operation_id,)).fetchone()
            if old:
                require(old["request_sha"] == request_sha, "OPERATION_CONFLICT", "This operation ID already identifies a different customer decision.")
                return {"reused": True, **json.loads(old["result_json"])}
            current = self.head()
            require(current["generation"] == generation and current["delivery_id"] == expected_delivery,
                    "HEAD_CONFLICT", "The active customer delivery changed; review the current head before deciding.")
            row = self._delivery(delivery_id)
            if rollback:
                require(self.db.execute("SELECT 1 FROM decisions WHERE delivery_id=? LIMIT 1", (delivery_id,)).fetchone(),
                        "ROLLBACK_TARGET", "Choose a delivery that was previously activated in this warehouse.")
            result = {**request, "generation": generation + 1, "at": now(),
                      "originalManifestSha256": row["manifest_sha"],
                      "originalAssessmentReady": json.loads(row["manifest"]).get("assessmentReady")}
            self.db.execute("UPDATE head SET generation=?,delivery_id=? WHERE singleton=1", (generation + 1, delivery_id))
            self.db.execute(
                "INSERT INTO decisions(operation_id,request_sha,kind,actor,reason,at,previous_id,delivery_id,generation,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (operation_id, request_sha, request["kind"], actor, reason, result["at"], expected_delivery, delivery_id, generation + 1, dumps(result)))
        return {"reused": False, **result}

    def _where(self, columns, filters):
        require(isinstance(filters, list) and len(filters) <= 32, "FILTERS", "Use at most 32 explicit exact-text filters.")
        names = [x["name"] for x in columns]
        clauses, params = [], []
        for item in filters:
            require(isinstance(item, dict) and item.get("column") in names, "FILTER_COLUMN", "Select an exact retained column name.")
            index = names.index(item["column"])
            name, kind = "c" + str(index), "k" + str(index)
            op = item.get("op", "eq")
            if op == "is-null":
                clauses.append(kind + "='null'")
            elif op in ("eq", "prefix", "contains"):
                require(isinstance(item.get("value"), str), "FILTER_VALUE", "Comparisons use exact text, including numeric lexemes.")
                if op == "eq":
                    clauses.append(name + "=?")
                    params.append(item["value"])
                elif op == "prefix":
                    clauses.append("substr(" + name + ",1,length(?))=?")
                    params.extend((item["value"], item["value"]))
                else:
                    clauses.append("instr(" + name + ",?)>0")
                    params.append(item["value"])
            else:
                raise ReceivingError("FILTER_OPERATOR", "Use eq, prefix, contains or is-null; no implicit numeric conversion is performed.")
            if "kind" in item:
                require(item["kind"] in ("null", "string", "number", "boolean", "object", "array"), "FILTER_KIND", "Unknown JSON kind.")
                clauses.append(kind + "=?")
                params.append(item["kind"])
        return (" AND ".join(clauses) or "1"), params

    def query(self, delivery_id=None, filters=None, after=0, limit=100):
        row = self._delivery(delivery_id)
        require(type(after) is int and after >= 0 and type(limit) is int and 1 <= limit <= 1000,
                "PAGE", "Use a nonnegative row cursor and a limit from 1 to 1000.")
        columns = json.loads(row["columns_json"])
        where, params = self._where(columns, filters or [])
        table = table_for(row["id"])
        total = self.db.execute("SELECT COUNT(*) FROM " + table + " WHERE " + where, params).fetchone()[0]
        values = self.db.execute("SELECT * FROM " + table + " WHERE _ordinal>? AND " + where + " ORDER BY _ordinal LIMIT ?",
                                 [after, *params, limit + 1]).fetchall()
        result = []
        for record in values[:limit]:
            result.append({"ordinal": record["_ordinal"], "exactJson": bytes(record["_raw"]).decode("utf-8").rstrip("\r\n"),
                           "cells": [{"name": c["name"], "path": c["path"], "text": record["c" + str(i)], "kind": record["k" + str(i)]}
                                     for i, c in enumerate(columns)]})
        return {"schema": "tj.databento-warehouse-page.v1", "deliveryId": row["id"], "originalManifestSha256": row["manifest_sha"],
                "head": self.head(), "columns": columns, "filters": filters or [], "total": total, "items": result,
                "nextAfter": result[-1]["ordinal"] if len(values) > limit else None}

    def add_index(self, delivery_id, column):
        require(not self.readonly, "READ_ONLY", "Open the warehouse to add a local query index.")
        row = self._delivery(delivery_id)
        names = [x["name"] for x in json.loads(row["columns_json"])]
        require(column in names, "INDEX_COLUMN", "Select an exact original column label.")
        index = names.index(column)
        table = table_for(row["id"])
        with transaction(self.db):
            self.db.execute("CREATE INDEX IF NOT EXISTS index_" + row["id"][9:] + "_" + str(index) + " ON " + table + "(c" + str(index) + ",k" + str(index) + ")")
            self.db.execute("INSERT OR IGNORE INTO warehouse_indexes VALUES(?,?,?)", (row["id"], index, now()))
        return {"deliveryId": row["id"], "column": column, "sqlColumn": "c" + str(index)}

    def export(self, directory, delivery_id=None, filters=None):
        # Freeze the selected head and its decision history in one brief read snapshot.
        # Completed row tables and original delivery documents are immutable thereafter.
        self.db.execute("BEGIN")
        try:
            row = self._delivery(delivery_id)
            captured_head = self.head()
            decisions = [json.loads(x[0]) for x in self.db.execute(
                "SELECT result_json FROM decisions WHERE delivery_id=? OR previous_id=? ORDER BY sequence", (row["id"], row["id"]))]
        finally:
            self.db.rollback()
        columns, filters = json.loads(row["columns_json"]), filters or []
        where, params = self._where(columns, filters)
        target = new_directory(directory)
        try:
            (target / "customer").mkdir()
            (target / "provenance").mkdir()
            (target / "provenance" / "original-manifest.json").write_bytes(bytes(row["manifest"]))
            names = [x["name"] for x in columns]
            count = 0
            with (target / DATA_JSON).open("wb") as out_json, (target / DATA_CSV).open("w", encoding="utf-8", newline="") as out_csv:
                writer = csv.writer(out_csv, lineterminator="\n")
                writer.writerow(names)
                for item in self.db.execute("SELECT * FROM " + table_for(row["id"]) + " WHERE " + where + " ORDER BY _ordinal", params):
                    out_json.write(bytes(item["_raw"]))
                    writer.writerow(["" if item["k" + str(i)] == "null" else item["c" + str(i)] for i in range(len(columns))])
                    count += 1
            for item in self.db.execute("SELECT path,body FROM documents WHERE delivery_id=? ORDER BY path", (row["id"],)):
                relative = "provenance/" + item["path"] if filters else item["path"]
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bytes(item["body"]))
            original = json.loads(row["manifest"])
            if not filters:
                original_entries = {x["path"]: x for x in original["files"]}
                for name in (DATA_JSON, DATA_CSV):
                    actual = identity(target / name)
                    require(actual["bytes"] == original_entries[name]["bytes"] and actual["sha256"] == original_entries[name]["sha256"],
                            "EXPORT_IDENTITY", "Complete received records do not reproduce the original customer file.")
                require(count == original["customerRecords"], "EXPORT_COUNT", "Export is not the complete received selection.")
            receipt = {"schema": "tj.databento-warehouse-export.v1", "createdAt": now(), "deliveryId": row["id"],
                       "originalManifestSha256": row["manifest_sha"], "originalEditionId": row["edition_id"],
                       "originalWorkspaceSha256": row["workspace_sha"], "originalCustomerRecords": original["customerRecords"],
                       "selectedRecords": count, "filters": filters, "selection": "filtered" if filters else "complete-original-customer",
                       "originalSourceCoverage": original["sourceCoverage"], "sourceRoleIsUnchanged": True,
                       "columns": columns, "headAtExport": captured_head}
            (target / "README.md").write_text(
                "# Databento customer receiving export\n\n"
                "This is the retained original customer selection" + (" filtered by the exact filters in receiving-manifest.json." if filters else ".") +
                "\n\nMapped JSON keeps original line bytes. CSV keeps original lexical values and selected labels. "
                "Numeric tokens are not converted to floating point. Original source role, scope, coverage and exclusions remain in provenance. "
                "A reference sample is not a production/preview comparison. "
                "Original operator notes and private review files are not included.\n", encoding="utf-8")
            (target / "receiving-decisions.json").write_text(
                dumps({"schema": "tj.databento-warehouse-decisions.v1", "deliveryId": row["id"],
                       "headAtExport": captured_head, "decisions": decisions}) + "\n", encoding="utf-8")
            overview = render_overview(self.inspect(row["id"]), self.query(row["id"], filters, limit=50), receipt, decisions)
            (target / "receiving-overview.html").write_text(overview, encoding="utf-8")
            receipt["files"] = []
            for p in sorted(target.rglob("*")):
                if p.is_file():
                    fsync_file(p)
                    receipt["files"].append({"path": p.relative_to(target).as_posix(), **identity(p)})
            (target / "receiving-manifest.json").write_text(dumps(receipt) + "\n", encoding="utf-8")
            fsync_file(target / "receiving-manifest.json")
            return {"directory": str(target), **receipt}
        except BaseException:
            shutil.rmtree(target)
            raise

    def backup(self, directory):
        target = new_directory(directory)
        try:
            destination = target / "warehouse.sqlite3"
            backup = sqlite3.connect(destination)
            try:
                self.db.backup(backup, pages=512)
                require(backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "BACKUP_INTEGRITY", "The copied database did not pass its native integrity check.")
                captured_head = dict(zip(("generation", "delivery_id"), backup.execute("SELECT generation,delivery_id FROM head WHERE singleton=1").fetchone()))
            finally:
                backup.close()
            os.chmod(destination, 0o600)
            (target / "receiver.py").write_bytes(Path(__file__).read_bytes())
            (target / "README.md").write_text(
                "# Databento customer warehouse\n\n"
                "This snapshot includes all staged deliveries, exact original row bytes and source manifests, "
                "the selected customer head, and its named activation/rollback history.\n\n"
                "Inspect with: python3 receiver.py status --warehouse .\n\n"
                "Restore to a new directory with: python3 receiver.py restore --bundle . --out /new/customer-warehouse\n\n"
                "Complete received deliveries need no provider credentials, producer workspace or network access. "
                "A snapshot taken during an incomplete import preserves its committed prefix; resuming that import needs the same original complete delivery directory. "
                "Receiving is a customer decision; it does not approve the provider's migration or turn reference scopes into a baseline/preview pair. "
                "Use Python 3.11+ on Linux/macOS. Existing destinations are preserved.\n", encoding="utf-8")
            files = []
            for p in sorted(target.iterdir()):
                fsync_file(p)
                files.append({"path": p.name, **identity(p)})
            manifest = {"schema": "tj.databento-warehouse-backup.v1", "createdAt": now(), "warehouseSchema": SCHEMA,
                        "head": captured_head, "files": files}
            (target / "backup-manifest.json").write_text(dumps(manifest) + "\n", encoding="utf-8")
            fsync_file(target / "backup-manifest.json")
            return {"directory": str(target), **manifest}
        except BaseException:
            shutil.rmtree(target)
            raise


def restore(bundle, directory):
    source = Path(bundle).resolve()
    manifest = metadata_document(read_metadata(regular_file(source, "backup-manifest.json")), "BACKUP_SCHEMA")
    require(manifest.get("schema") == "tj.databento-warehouse-backup.v1"
            and manifest.get("warehouseSchema") == SCHEMA, "BACKUP_SCHEMA", "Select a complete customer receiving backup.")
    entries = manifest.get("files", [])
    require(isinstance(entries, list) and len(entries) == 3 and all(isinstance(x, dict) for x in entries)
            and {x.get("path") for x in entries} == {"warehouse.sqlite3", "receiver.py", "README.md"},
            "BACKUP_FILES", "The complete original warehouse backup is required.")
    require(all(type(x.get("bytes")) is int and x["bytes"] >= 0 and HASH.fullmatch(str(x.get("sha256", "")))
                for x in entries), "BACKUP_FILES", "Backup members require exact size and SHA256 identities.")
    require(isinstance(manifest.get("head"), dict), "BACKUP_HEAD", "The copied customer head is required.")
    for entry in entries:
        verify_member(source, entry)
    target = new_directory(directory)
    try:
        shutil.copyfile(regular_file(source, "warehouse.sqlite3"), target / "warehouse.sqlite3")
        os.chmod(target / "warehouse.sqlite3", 0o600)
        expected = next(x for x in entries if x["path"] == "warehouse.sqlite3")
        actual = identity(target / "warehouse.sqlite3")
        require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
                "BACKUP_CHANGED", "Backup bytes changed while restoring.")
        (target / "locks").mkdir(mode=0o700)
        warehouse = Warehouse(target)
        try:
            require(warehouse.db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "RESTORE_INTEGRITY", "The restored database is not intact.")
            require(not warehouse.db.execute("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger','view') LIMIT 1").fetchone(),
                    "RESTORE_SCHEMA", "Unexpected executable schema in the receiving snapshot.")
            require(warehouse.head() == manifest["head"], "RESTORE_HEAD", "The original snapshot head does not match the backup manifest.")
            result = warehouse.status()
        finally:
            warehouse.close()
        return {"directory": str(target), "restored": True, **result}
    except BaseException:
        shutil.rmtree(target)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("init", help="Create a new customer warehouse.")
    p.add_argument("--warehouse", required=True)
    for name in ("status", "inspect", "query", "receive", "activate", "rollback", "index", "export", "backup"):
        p = commands.add_parser(name)
        p.add_argument("--warehouse", required=True)
        if name in ("inspect", "query", "activate", "rollback", "index", "export"):
            p.add_argument("--delivery", required=name in ("activate", "rollback", "index"))
        if name == "receive":
            p.add_argument("--delivery-directory", required=True)
        if name in ("activate", "rollback"):
            p.add_argument("--expected-generation", required=True, type=int)
            p.add_argument("--expected-delivery", required=True, help="Use none for an empty warehouse.")
            p.add_argument("--actor", required=True)
            p.add_argument("--reason", required=True)
            p.add_argument("--operation-id", required=True)
        if name == "index":
            p.add_argument("--column", required=True)
        if name in ("query", "export"):
            p.add_argument("--filters-json", default="[]")
        if name == "query":
            p.add_argument("--after", type=int, default=0)
            p.add_argument("--limit", type=int, default=100)
        if name in ("export", "backup"):
            p.add_argument("--out", required=True)
    p = commands.add_parser("restore")
    p.add_argument("--bundle", required=True)
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.command == "restore":
        return restore(args.bundle, args.out)
    if args.command == "init":
        warehouse = Warehouse.create(args.warehouse)
    else:
        warehouse = Warehouse(args.warehouse, readonly=args.command in ("status", "inspect", "query", "export", "backup"))
    try:
        if args.command in ("init", "status"):
            return warehouse.status()
        if args.command == "inspect":
            return warehouse.inspect(args.delivery)
        if args.command == "receive":
            return warehouse.receive(args.delivery_directory)
        if args.command == "query":
            return warehouse.query(args.delivery, json.loads(args.filters_json), args.after, args.limit)
        if args.command in ("activate", "rollback"):
            return warehouse.activate(args.delivery, args.expected_generation,
                                      None if args.expected_delivery == "none" else args.expected_delivery,
                                      args.actor, args.reason, args.operation_id, args.command == "rollback")
        if args.command == "index":
            return warehouse.add_index(args.delivery, args.column)
        if args.command == "export":
            return warehouse.export(args.out, args.delivery, json.loads(args.filters_json))
        if args.command == "backup":
            return warehouse.backup(args.out)
    finally:
        warehouse.close()


if __name__ == "__main__":
    try:
        print(dumps(main()))
    except (ReceivingError, OSError, sqlite3.Error, csv.Error, json.JSONDecodeError, UnicodeError) as error:
        print(dumps({"error": {"code": getattr(error, "code", type(error).__name__), "message": str(error)}}), file=sys.stderr)
        sys.exit(1)

