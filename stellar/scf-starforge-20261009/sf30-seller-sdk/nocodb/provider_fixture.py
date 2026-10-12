#!/usr/bin/env python3
"""Prepare the exact upstream NocoDB Sakila fixture for a real provider import.

Retain the pinned original database and selected source rows. Import them into
the selected real NocoDB instance, then use its original source capture CLI.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import urllib.request
import uuid
from datetime import datetime, timezone

COMMIT = "ba068da3a8e984ab807841b632df695cdfa4e8a0"
URL = "https://raw.githubusercontent.com/nocodb/nocodb/" + COMMIT + "/packages/nocodb/tests/sqlite-sakila-db/sakila.db"
GIT_BLOB = "2f7281e5d055983635c50a3b1c09e274afbc5b2e"
DB_BYTES = 4964352
SCHEMA = "tjl.nocodb-upstream-fixture.v1"
TABLES = {
    "actor": {
        "key": "actor_id",
        "columns": [
            ("actor_id", "Number"), ("first_name", "SingleLineText"),
            ("last_name", "SingleLineText"), ("last_update", "SingleLineText")
        ]
    },
    "film": {
        "key": "film_id",
        "columns": [
            ("film_id", "Number"), ("title", "SingleLineText"),
            ("description", "LongText"), ("release_year", "Number"),
            ("language_id", "Number"), ("original_language_id", "Number"),
            ("rental_duration", "Number"), ("rental_rate", "Decimal"),
            ("length", "Number"), ("replacement_cost", "Decimal"),
            ("rating", "SingleLineText"), ("special_features", "LongText"),
            ("last_update", "SingleLineText")
        ]
    }
}

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")

def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def create_file(path, data):
    """Create complete bytes exclusively; never replace an existing artifact."""
    tmp = path.parent / ("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = None
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            fd = None
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.link(tmp, path)
        fsync_dir(path.parent)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
    actual = path.read_bytes()
    if actual != data:
        raise RuntimeError("Prepared artifact readback changed: " + path.name)
    return {"file": path.name, "bytes": len(data), "sha256": digest(data)}

def original_database(local):
    if local:
        path = Path(local).absolute()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size != DB_BYTES:
                raise ValueError("Local original must be the exact regular upstream database file.")
            with os.fdopen(fd, "rb") as inp:
                fd = None
                data = inp.read(DB_BYTES + 1)
        finally:
            if fd is not None:
                os.close(fd)
        receipt = {"transport": "LOCAL_ORIGINAL_FILE", "source_path": str(path), "observed_at": now()}
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "TokenJunkieLabs-NocoDB-Source-Intake/1.0", "Accept": "application/octet-stream"})
        started = now()
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 200 or response.url != URL:
                raise RuntimeError("Upstream original URL/status changed.")
            data = response.read(DB_BYTES + 1)
            receipt = {"transport": "HTTPS", "method": "GET", "request_url": URL,
                       "response_url": response.url, "status": response.status,
                       "requested_at": started, "received_at": now(),
                       "headers": {name: response.headers[name] for name in
                                   ("Content-Type", "Content-Length", "ETag", "Last-Modified")
                                   if response.headers.get(name) is not None}}
    git_blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
    if len(data) != DB_BYTES or git_blob != GIT_BLOB:
        raise ValueError("Retrieved bytes differ from the pinned upstream Git object.")
    return data, {**receipt, "bytes": len(data), "sha256": digest(data), "git_blob": git_blob}

def prepare(output, local=None):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError("Use a new original preparation directory; keep any previous incomplete output.")
    output.parent.mkdir(parents=True, exist_ok=True)
    os.mkdir(output, 0o700)
    fsync_dir(output.parent)
    files = []
    try:
        data, receipt = original_database(local)
        files.append(create_file(output / "sakila.db", data))
        files.append(create_file(output / "source-receipt.json", json_bytes(receipt)))
        # The in-memory clone leaves the retained original DB byte-for-byte intact.
        db = sqlite3.connect(":memory:")
        try:
            db.deserialize(data)
            db.execute("PRAGMA query_only=ON")
            check = db.execute("PRAGMA integrity_check").fetchone()
            if check != ("ok",):
                raise ValueError("Original SQLite integrity check did not return ok.")
            summaries = []
            for table, spec in TABLES.items():
                names = [name for name, _ in spec["columns"]]
                declared = db.execute('PRAGMA table_info("' + table + '")').fetchall()
                actual_names = [row[1] for row in declared]
                if set(names) != set(actual_names):
                    raise ValueError("Pinned original " + table + " schema differs from the explicit import selection.")
                sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
                columns = ", ".join('"' + name + '"' for name in names)
                select_sql = 'SELECT ' + columns + ' FROM "' + table + '" ORDER BY "' + spec["key"] + '" ASC'
                rows = [dict(zip(names, row)) for row in db.execute(select_sql).fetchall()]
                ids = [row[spec["key"]] for row in rows]
                if len(set(ids)) != len(ids) or any(value is None for value in ids):
                    raise ValueError("The selected original source key is not complete and unique.")
                typed = {"schema": "tjl.nocodb-original-table-input.v1", "upstream_table": table,
                         "source_database_sha256": receipt["sha256"], "query": select_sql,
                         "columns": [{"name": name, "proposed_provider_type": field_type}
                                     for name, field_type in spec["columns"]],
                         "sqlite_table_info": [list(row) for row in declared],
                         "original_create_sql": sql[0], "rows": rows}
                files.append(create_file(output / (table + ".rows.json"), json_bytes(typed)))
                text = io.StringIO(newline="")
                writer = csv.DictWriter(text, fieldnames=names, lineterminator="\n")
                writer.writeheader()
                writer.writerows(rows)
                files.append(create_file(output / (table + ".csv"), text.getvalue().encode("utf-8")))
                table_body = {"title": "Upstream Sakila " + table,
                              "description": "Original NocoDB upstream fixture " + COMMIT +
                                  "; " + table + "; provider import preparation only.",
                              "fields": [
                                  {"title": name, "type": field_type,
                                   **({"unique": True} if name == spec["key"] else {}),
                                   **({"options": {"precision": 2}} if field_type == "Decimal" else {})}
                                  for name, field_type in spec["columns"]
                              ]}
                files.append(create_file(output / (table + ".table-create.json"), json_bytes(table_body)))
                summaries.append({"source_table": table, "source_key": spec["key"], "records": len(rows),
                                  "columns": len(names), "null_counts": {name: sum(row[name] is None for row in rows) for name in names},
                                  "empty_text_counts": {name: sum(row[name] == "" for row in rows) for name in names},
                                  "source_ids_sha256": digest(json_bytes(ids)),
                                  "input_rows": table + ".rows.json", "csv": table + ".csv",
                                  "proposed_table_create": table + ".table-create.json"})
        finally:
            db.close()
        manifest = {"schema": SCHEMA, "prepared_at": now(), "state": "UPSTREAM_SOURCE_READY",
                    "provider_run_completed": False, "running_provider_version": None,
                    "upstream": {"repository": "nocodb/nocodb", "commit": COMMIT,
                                 "path": "packages/nocodb/tests/sqlite-sakila-db/sakila.db",
                                 "url": URL, "git_blob": GIT_BLOB, "bytes": DB_BYTES, "sha256": receipt["sha256"]},
                    "tables": summaries, "files": files,
                    "source_semantics": "Original SQLite values. Date/time text remains text in the proposed import. Native NocoDB IDs do not exist until the actual service import.",
                    "csv_semantics": "CSV is an operator convenience. Empty text and SQL NULL both appear blank; actor.rows.json/film.rows.json and the original database retain the distinct actual values.",
                    "next_operation": "Import selected original records into an explicitly authorized isolated real NocoDB base. Retain actual response IDs/version and invoke the original nocodb/cli.mjs discover, capture and freeze. Preserve the actual provider response history."}
        result = create_file(output / "manifest.json", json_bytes(manifest))
        fsync_dir(output)
        print(json.dumps({"state": manifest["state"], "directory": str(output),
                          "manifest": result, "upstream": manifest["upstream"],
                          "tables": summaries, "provider_run_completed": False}, sort_keys=True))
    except BaseException as error:
        # Keep received originals. No complete manifest is manufactured on failure.
        try:
            create_file(output / "INCOMPLETE.json", json_bytes(
                {"schema": SCHEMA, "state": "SOURCE_PREPARATION_INCOMPLETE", "recorded_at": now(),
                 "error_type": type(error).__name__, "retained_files": files,
                 "provider_run_completed": False}))
        except OSError:
            pass
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="New original source preparation directory.")
    parser.add_argument("--db", help="Optional already retained exact upstream DB; otherwise retrieve pinned HTTPS original.")
    args = parser.parse_args()
    prepare(args.out, args.db)

if __name__ == "__main__":
    main()
