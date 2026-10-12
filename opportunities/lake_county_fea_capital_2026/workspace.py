"""Native source, edition, decision and receiving workspace for the FEA workshare."""
from __future__ import annotations
import base64
import csv
import fcntl
import hashlib
import html
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from collections import Counter
from domain import (ProgrammeError, TABLES, SCHEMA, require, identifier, stable, digest,
                    validate_mapping, project_record, read_table, compare_records,
                    evaluate_scenario, fact_issue)

MAX_FILE = 32 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024
RUNTIME_FILES = ("domain.py", "workspace.py", "server.py", "cli.py", "operate.py",
                 "web/index.html", "web/app.js", "web/style.css", "operate_browser.mjs", "README.md",
                 "INPUTS.md", "WORKSHARE.md", "LICENSE", "commission_public.py")
DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,
 name TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(edition_id TEXT NOT NULL,table_name TEXT NOT NULL,row_id TEXT NOT NULL,
 file_id TEXT NOT NULL,source_row INTEGER NOT NULL,physical_line INTEGER,key_text TEXT,
 raw_json TEXT NOT NULL,value_json TEXT NOT NULL,issues_json TEXT NOT NULL,sha256 TEXT NOT NULL,
 PRIMARY KEY(edition_id,row_id));
CREATE INDEX IF NOT EXISTS records_page ON records(edition_id,table_name,source_row,row_id);
CREATE INDEX IF NOT EXISTS records_keys ON records(edition_id,table_name,key_text);
CREATE TABLE IF NOT EXISTS versions(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
 sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id,revision));
CREATE TABLE IF NOT EXISTS heads(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
 PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,
 request_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
"""

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def atomic(path, data, *, replace=False, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not path.is_symlink(), "path", "A selected file must not be a symlink.")
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if replace:
            os.replace(name, path)
        else:
            try:
                os.link(name, path)
            except FileExistsError:
                require(path.is_file() and path.read_bytes() == data, "immutable_conflict",
                        "An immutable file already has different bytes.", {"path": str(path)}, 409)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def file_identity(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "file", "Select an existing regular file.")
    h, size = hashlib.sha256(), 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            h.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": h.hexdigest()}

def safe_relative(name):
    require(isinstance(name, str) and name and "\\" not in name and "\0" not in name,
            "archive_path", "Archive paths must be explicit relative POSIX paths.")
    p = PurePosixPath(name)
    require(not p.is_absolute() and all(x not in {"", ".", ".."} for x in p.parts)
            and str(p) == name, "archive_path", "Unsafe archive member path.")
    return p

def connect(path):
    con = sqlite3.connect(path, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA journal_mode=DELETE")
    con.execute("PRAGMA synchronous=FULL")
    return con

class Workspace:
    @classmethod
    def create(cls, root, *, case_id, packet_sha256, actor):
        root = Path(root).resolve()
        identifier(case_id, "Original case ID")
        identifier(actor, "Local operator")
        require(isinstance(packet_sha256, str) and len(packet_sha256) == 64
                and all(c in "0123456789abcdef" for c in packet_sha256),
                "source_pin", "Bind the exact original prepared workshare source SHA-256.")
        root.parent.mkdir(parents=True, exist_ok=True)
        intent_path = root.parent / (root.name + ".initialize.json")
        if intent_path.exists():
            intent = json.loads(intent_path.read_text(encoding="utf-8"))
            require(intent.get("schema") == "lake-county.workspace-initialization/v1"
                    and intent.get("destination") == str(root)
                    and intent.get("context", {}).get("case_id") == case_id
                    and intent["context"].get("packet_sha256") == packet_sha256
                    and intent["context"].get("created_by") == actor,
                    "initialization_conflict", "Retain this directory's original initialization selection.", status=409)
            context, stage = intent["context"], Path(intent["stage"])
        else:
            require(not root.exists(), "workspace_exists", "Reopen the selected workspace; do not create over it.", status=409)
            stage = root.parent / (root.name + ".initializing-" + uuid.uuid4().hex)
            context = {"schema": SCHEMA, "workspace_id": str(uuid.uuid4()), "case_id": case_id,
                       "packet_sha256": packet_sha256, "created_by": actor, "created_at": now(),
                       "purpose": "internal_engineering_for_original_proposed_workshare",
                       "client_acceptance": "not_established"}
            intent = {"schema": "lake-county.workspace-initialization/v1", "destination": str(root),
                      "stage": str(stage), "context": context}
            atomic(intent_path, stable(intent).encode())
        require(stage.parent == root.parent and stage.name.startswith(root.name + ".initializing-")
                and not stage.is_symlink() and not root.is_symlink(),
                "initialization_path", "Keep the original private initialization directory.")
        if root.exists():
            reopened = cls(root)
            try:
                require(reopened.context == context, "initialization_identity",
                        "The selected destination contains another native workspace.", status=409)
                return reopened
            except Exception:
                reopened.close()
                raise
        if stage.exists():
            try:
                reopened = cls(stage)
                try:
                    require(reopened.context == context and reopened.revision() == digest(context)
                            and all(reopened.db.execute("SELECT count(*) FROM " + table).fetchone()[0] == 0
                                    for table in ("files", "editions", "records", "versions", "heads", "operations")),
                            "initialization_changed", "The unconfirmed initialization stage contains later or different work.", status=409)
                finally:
                    reopened.close()
            except Exception as exc:
                raise ProgrammeError("initialization_pending",
                    "The original partial initialization is preserved. Resolve that same stage before creating or publishing a workspace.",
                    {"stage": str(stage), "cause": str(exc)}, 409)
        else:
            stage.mkdir(mode=0o700)
            atomic(stage / "initialization.json", stable({"destination": str(root), "context": context}).encode())
            (stage / "objects").mkdir(mode=0o700)
            con = connect(stage / "workspace.sqlite3")
            try:
                con.executescript(DB_SCHEMA)
                con.execute("INSERT INTO meta VALUES(?,?)", ("context", stable(context)))
                con.execute("INSERT INTO meta VALUES(?,?)", ("revision", stable(digest(context))))
                con.execute("INSERT INTO meta VALUES(?,?)", ("sequence", "0"))
                con.commit()
            finally:
                con.close()
        rename_new_directory(stage, root)
        return cls(root)

    def __init__(self, root):
        self.root = Path(root).resolve()
        require(self.root.is_dir() and not self.root.is_symlink()
                and (self.root / "workspace.sqlite3").is_file(), "workspace",
                "Open the original complete workspace. An incomplete initialization is preserved for recovery.")
        self.thread_lock = threading.RLock()
        self.db = connect(self.root / "workspace.sqlite3")
        try:
            self.context = json.loads(self.db.execute("SELECT value FROM meta WHERE key='context'").fetchone()[0])
            require(self.context.get("schema") == SCHEMA, "workspace_schema", "Select the original facility workspace schema.")
        except (sqlite3.Error, TypeError, KeyError, json.JSONDecodeError):
            self.db.close()
            raise ProgrammeError("workspace_schema", "Workspace metadata is incomplete; retain this original directory.")
        self.lock_handle = open(self.root / "workspace.lock", "a+b")

    def close(self):
        self.db.close()
        self.lock_handle.close()

    @contextmanager
    def lock(self):
        with self.thread_lock:
            fcntl.flock(self.lock_handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(self.lock_handle, fcntl.LOCK_UN)

    def revision(self):
        return json.loads(self.db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])

    def _blob(self, sha):
        require(isinstance(sha, str) and len(sha) == 64 and all(c in "0123456789abcdef" for c in sha),
                "blob", "Invalid immutable object identity.")
        return self.root / "objects" / sha[:2] / sha

    def _retain(self, data):
        require(isinstance(data, bytes) and len(data) <= MAX_FILE, "file_limit", "Each supplied file must be at most 32 MiB.")
        sha = digest(data)
        atomic(self._blob(sha), data)
        return {"sha256": sha, "bytes": len(data)}

    def _file(self, file_id, verify=True):
        row = self.db.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
        require(row is not None, "file_missing", "Original selected file is absent.", {"file_id": file_id})
        result = dict(row)
        result["metadata"] = json.loads(result["metadata"])
        if verify:
            require(file_identity(self._blob(result["sha256"])) == {k: result[k] for k in ("sha256", "bytes")},
                    "file_integrity", "The retained original file no longer matches its source identity.")
        return result

    def file(self, file_id):
        with self.lock():
            return self._file(file_id)

    def _edition(self, edition_id):
        row = self.db.execute("SELECT * FROM editions WHERE id=?", (edition_id,)).fetchone()
        require(row is not None, "edition_missing", "Select a retained original source edition.")
        body = json.loads(row["body"])
        require(digest(body) == row["sha256"], "edition_integrity", "Source-edition bytes do not match.")
        return {**body, "sha256": row["sha256"]}

    def _object(self, kind, object_id, revision=None):
        if revision is None:
            head = self.db.execute("SELECT revision FROM heads WHERE kind=? AND id=?", (kind, object_id)).fetchone()
            require(head is not None, "object_missing", "Selected object is absent.")
            revision = head[0]
        row = self.db.execute("SELECT * FROM versions WHERE kind=? AND id=? AND revision=?", (kind, object_id, revision)).fetchone()
        require(row is not None, "version_missing", "The original selected version is absent.")
        body = json.loads(row["body"])
        require(digest(body) == row["sha256"], "version_integrity", "Selected version bytes do not match.")
        return {"kind": kind, "id": object_id, "revision": row["revision"], "sha256": row["sha256"], "body": body}

    def object(self, kind, object_id, revision=None):
        with self.lock():
            return self._object(kind, object_id, revision)

    def _save(self, kind, object_id, expected_version, body):
        head = self.db.execute("SELECT revision FROM heads WHERE kind=? AND id=?", (kind, object_id)).fetchone()
        actual = None if head is None else head[0]
        require(actual == expected_version, "object_conflict", "The selected record changed. Review the retained draft against its current version.",
                {"kind": kind, "id": object_id, "expected": expected_version, "actual": actual}, 409)
        version = 1 if actual is None else actual + 1
        sha = digest(body)
        self.db.execute("INSERT INTO versions VALUES(?,?,?,?,?)", (kind, object_id, version, sha, stable(body)))
        self.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision",
                        (kind, object_id, version))
        return {"kind": kind, "id": object_id, "revision": version, "sha256": sha, "body": body}

    def _rows(self, edition_id, table=None):
        values = [edition_id]
        sql = "SELECT * FROM records WHERE edition_id=?"
        if table is not None:
            sql += " AND table_name=?"
            values.append(table)
        for row in self.db.execute(sql + " ORDER BY table_name,file_id,source_row,row_id", values):
            yield {"row_id": row["row_id"], "table": row["table_name"], "file_id": row["file_id"],
                   "source_row": row["source_row"], "physical_line": row["physical_line"],
                   "key": row["key_text"], "raw": json.loads(row["raw_json"]),
                   "values": json.loads(row["value_json"]), "issues": json.loads(row["issues_json"]),
                   "sha256": row["sha256"]}

    def _id(self, operation, kind):
        return kind + "-" + digest([self.context["workspace_id"], operation, kind])[:24]

    def status(self):
        with self.lock():
            files = [self._file(r[0], False) for r in self.db.execute("SELECT id FROM files ORDER BY created_at,id")]
            editions = [self._edition(r[0]) for r in self.db.execute("SELECT id FROM editions")]
            objects = {}
            for head in self.db.execute("SELECT kind,id,revision FROM heads ORDER BY kind,id"):
                obj = self._object(head["kind"], head["id"], head["revision"])
                objects.setdefault(head["kind"], []).append(obj)
            return {"context": self.context, "revision": self.revision(), "files": files,
                    "editions": editions, "objects": objects, "tables": TABLES,
                    "limits": {"file_bytes": MAX_FILE, "rows_per_register": 200000},
                    "client_inputs": "Only actually imported records are present; this workspace does not establish client acceptance."}

    def rows(self, edition_id, table=None, offset=0, limit=100, only_issues=False):
        require(isinstance(offset, int) and offset >= 0 and isinstance(limit, int) and 1 <= limit <= 1000,
                "pagination", "Use a nonnegative offset and page size from 1 to 1000.")
        with self.lock():
            self._edition(edition_id)
            sql, args = "FROM records WHERE edition_id=?", [edition_id]
            if table:
                require(table in TABLES, "table", "Unknown register.")
                sql += " AND table_name=?"
                args.append(table)
            if only_issues:
                sql += " AND issues_json!='[]'"
            total = self.db.execute("SELECT count(*) " + sql, args).fetchone()[0]
            page = self.db.execute("SELECT row_id " + sql + " ORDER BY table_name,file_id,source_row,row_id LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
            ids = {row[0] for row in page}
            selected = [r for r in self._rows(edition_id, table) if r["row_id"] in ids]
            return {"rows": selected, "total": total, "offset": offset, "next_offset": offset + len(selected) if offset + len(selected) < total else None}

    def operation(self, operation_id):
        with self.lock():
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
            return {"status": "not_applied", "operation_id": operation_id} if row is None else {
                "status": "complete", "request_sha256": row["request_sha256"],
                "request": json.loads(row["request_json"]), "result": json.loads(row["result_json"])}

    def apply(self, request):
        require(isinstance(request, dict) and set(request) == {"operation_id", "actor", "workspace_id", "expected_revision", "action", "payload"},
                "request", "Use the complete original mutation request.")
        identifier(request["operation_id"], "Operation ID")
        identifier(request["actor"], "Local operator")
        require(request["workspace_id"] == self.context["workspace_id"], "workspace_identity",
                "Request belongs to another native workspace.")
        require(isinstance(request["payload"], dict), "payload", "Action payload must be an object.")
        request_sha = digest(request)
        with self.lock():
            self.db.execute("BEGIN IMMEDIATE")
            try:
                prior = self.db.execute("SELECT * FROM operations WHERE id=?", (request["operation_id"],)).fetchone()
                if prior:
                    require(prior["request_sha256"] == request_sha, "operation_conflict",
                            "The original operation is already bound to different input; retain its request.", status=409)
                    result = json.loads(prior["result_json"])
                    self.db.rollback()
                    return result
                require(request["expected_revision"] == self.revision(), "revision_conflict",
                        "Workspace changed before this request. Review the original draft; do not silently rebase it.",
                        {"expected": request["expected_revision"], "actual": self.revision()}, 409)
                handlers = {
                    "file.retain": self._upload, "edition.create": self._create_edition,
                    "edition.compare": self._compare_editions, "review.save": self._review,
                    "crosswalk.save": self._crosswalk, "exchange.prepare": self._prepare_exchange,
                    "exchange.return": self._return_exchange, "exchange.adopt": self._adopt_exchange,
                    "scenario.save": self._scenario, "publication.create": self._publish,
                }
                require(request["action"] in handlers, "action", "Unknown workspace action.")
                result = handlers[request["action"]](request["payload"], request)
                revision = digest([self.revision(), request_sha, result])
                self.db.execute("UPDATE meta SET value=? WHERE key='revision'", (stable(revision),))
                self.db.execute("UPDATE meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='sequence'")
                response = {"operation_id": request["operation_id"], "request_sha256": request_sha,
                            "workspace_id": self.context["workspace_id"], "revision": revision,
                            "action": request["action"], "result": result}
                self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?)",
                                (request["operation_id"], request_sha, stable(request), stable(response), now()))
                self.db.commit()
                return response
            except Exception:
                self.db.rollback()
                raise

    def _upload(self, p, req):
        require(set(p) == {"name", "mime", "bytes", "sha256", "base64", "metadata"}, "upload", "Supply exact file bytes, identity and source metadata.")
        require(isinstance(p["name"], str) and p["name"] == Path(p["name"]).name and p["name"] not in {"", ".", ".."}
                and "\0" not in p["name"] and "\\" not in p["name"], "filename", "Use the original file basename.")
        require(isinstance(p["mime"], str) and 1 <= len(p["mime"]) <= 150 and "\r" not in p["mime"] and "\n" not in p["mime"] and all(32 <= ord(c) < 127 for c in p["mime"]), "mime", "Use a single-line ASCII media type.")
        require(isinstance(p["metadata"], dict) and p["metadata"].get("source_kind")
                and p["metadata"].get("authority"), "source_metadata", "State source kind and actual source authority.")
        require(isinstance(p["base64"], str) and len(p["base64"]) <= (MAX_FILE * 4 // 3 + 8), "file_limit", "File exceeds 32 MiB.")
        try:
            data = base64.b64decode(p["base64"], validate=True)
        except Exception:
            raise ProgrammeError("base64", "File content is not valid base64.")
        require(len(data) == p["bytes"] and digest(data) == p["sha256"], "file_identity", "Uploaded bytes do not match the selected file.")
        retained = self._retain(data)
        file_id = self._id(req["operation_id"], "file")
        self.db.execute("INSERT INTO files VALUES(?,?,?,?,?,?,?)",
                        (file_id, retained["sha256"], retained["bytes"], p["name"], p["mime"], stable(p["metadata"]), now()))
        return self._file(file_id)

    def _create_edition(self, p, req):
        require(isinstance(p.get("name"), str) and p["name"].strip() and isinstance(p.get("selections"), list)
                and p["selections"], "edition", "Name the edition and select original files.")
        predecessor = p.get("predecessor_id")
        if predecessor:
            self._edition(predecessor)
        edition_id = self._id(req["operation_id"], "edition")
        selections, counts, parse_issues = [], Counter(), []
        seen = set()
        for selection in p["selections"]:
            require(isinstance(selection, dict), "selection", "Each selected source is an object.")
            f = self._file(selection.get("file_id"))
            table = selection.get("table", "document")
            token = (f["id"], table)
            require(token not in seen, "selection", "A file/register pair is selected more than once.")
            seen.add(token)
            selected = {"file_id": f["id"], "sha256": f["sha256"], "bytes": f["bytes"], "table": table,
                        "format": selection.get("format", "document"), "mapping": selection.get("mapping")}
            selections.append(selected)
            if table == "document":
                require(selected["format"] == "document" and selected["mapping"] is None,
                        "document", "Documents are retained as exact original files without invented rows.")
                continue
            mapping = validate_mapping(table, selected["mapping"])
            try:
                for ordinal, line, raw, structure in read_table(self._blob(f["sha256"]), selected["format"], mapping):
                    values, key, issues = project_record(table, raw, mapping, structure)
                    row_id = digest([edition_id, f["id"], table, ordinal])
                    subject = {"table": table, "file_id": f["id"], "source_row": ordinal,
                               "physical_line": line, "raw": raw, "values": values}
                    self.db.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                    (edition_id, table, row_id, f["id"], ordinal, line, key,
                                     stable(raw), stable(values), stable(issues), digest(subject)))
                    counts[table] += 1
            except (ProgrammeError, csv.Error, UnicodeError, json.JSONDecodeError) as exc:
                parse_issues.append({"file_id": f["id"], "table": table, "code": getattr(exc, "code", "parse"),
                                     "message": str(exc), "rows_retained": counts[table]})
        # Complete source rows are retained. A repeated key never resolves to a first row.
        duplicate_keys = self.db.execute(
            "SELECT table_name,key_text,count(*) n FROM records WHERE edition_id=? AND key_text IS NOT NULL GROUP BY table_name,key_text HAVING count(*)>1",
            (edition_id,)).fetchall()
        for duplicate in duplicate_keys:
            for row in self.db.execute("SELECT row_id,issues_json FROM records WHERE edition_id=? AND table_name=? AND key_text=?",
                                       (edition_id, duplicate["table_name"], duplicate["key_text"])).fetchall():
                issues = json.loads(row["issues_json"])
                issues.append(fact_issue("duplicate_key", "This exact normalized identifier occurs more than once; preserve every row and obtain an explicit source correction.",
                                         TABLES[duplicate["table_name"]]["key"], occurrences=duplicate["n"]))
                self.db.execute("UPDATE records SET issues_json=? WHERE edition_id=? AND row_id=?", (stable(issues), edition_id, row["row_id"]))
        assets = Counter(r[0] for r in self.db.execute("SELECT key_text FROM records WHERE edition_id=? AND table_name='assets' AND key_text IS NOT NULL", (edition_id,)))
        for row in list(self._rows(edition_id)):
            if TABLES[row["table"]]["refs"]:
                reference = row["values"].get("source_asset_id")
                if not isinstance(reference, str) or assets[reference] != 1:
                    issues = row["issues"] + [fact_issue("asset_reference_unresolved",
                            "Original asset reference is absent or ambiguous; no fuzzy identity or ownership is inferred.",
                            "source_asset_id", reference=reference, matches=assets.get(reference, 0))]
                    self.db.execute("UPDATE records SET issues_json=? WHERE edition_id=? AND row_id=?", (stable(issues), edition_id, row["row_id"]))
        issue_count = sum(len(r["issues"]) for r in self._rows(edition_id))
        body = {"id": edition_id, "name": p["name"].strip(), "predecessor_id": predecessor,
                "created_at": now(), "actor": req["actor"], "selections": selections,
                "counts": dict(counts), "issue_count": issue_count, "parse_issues": parse_issues,
                "intake_complete": not parse_issues, "client_records_present": bool(counts.get("assets", 0)) and any(s["table"] == "assets" and self._file(s["file_id"], False)["metadata"].get("source_kind") in {"client_asset_register", "prime_asset_register"} for s in selections)}
        self.db.execute("INSERT INTO editions VALUES(?,?,?)", (edition_id, digest(body), stable(body)))
        return self._edition(edition_id)

    def _compare_editions(self, p, req):
        before, after = self._edition(p.get("baseline_id")), self._edition(p.get("candidate_id"))
        tables = p.get("tables", list(TABLES))
        require(isinstance(tables, list) and set(tables) <= set(TABLES) and len(set(tables)) == len(tables), "tables", "Select unique known registers.")
        results = {}
        for table in tables:
            results[table] = compare_records(list(self._rows(before["id"], table)), list(self._rows(after["id"], table)), [TABLES[table]["key"]])
        body = {"baseline": {"id": before["id"], "sha256": before["sha256"]},
                "candidate": {"id": after["id"], "sha256": after["sha256"]},
                "tables": results, "intake_complete": before["intake_complete"] and after["intake_complete"],
                "created_at": now(), "actor": req["actor"]}
        return self._save("comparison", self._id(req["operation_id"], "comparison"), None, body)

    def _subject(self, kind, selected_id, revision=None, edition_id=None):
        if kind == "edition":
            subject = self._edition(selected_id)
            return subject["sha256"], subject
        if kind == "row":
            require(edition_id, "review", "Row decisions require the exact source edition.")
            row = next((r for r in self._rows(edition_id) if r["row_id"] == selected_id), None)
            require(row, "review", "Review subject is absent.")
            return row["sha256"], row
        obj = self._object(kind, selected_id, revision)
        return obj["sha256"], obj

    def _review(self, p, req):
        require(p.get("status") in {"accepted", "follow_up", "rejected"}, "review", "Use an explicit review decision.")
        require(isinstance(p.get("note"), str) and p["note"].strip(), "review", "Describe the actual review and its limits.")
        kind = p.get("subject_kind")
        require(kind in {"edition", "row", "scenario", "exchange", "comparison", "crosswalk"}, "review", "Select a reviewable subject.")
        sha, subject = self._subject(kind, p.get("subject_id"), p.get("subject_revision"), p.get("edition_id"))
        require(sha == p.get("subject_sha256"), "review_stale", "Review is bound to different source bytes.", status=409)
        if kind == "edition" and p["status"] == "accepted":
            require(subject["intake_complete"], "review_incomplete", "A structural source parse cannot be accepted as complete.")
        body = {"subject_kind": kind, "subject_id": p["subject_id"], "subject_revision": p.get("subject_revision"),
                "edition_id": p.get("edition_id"), "subject_sha256": sha, "status": p["status"],
                "note": p["note"].strip(), "actor": req["actor"], "created_at": now(),
                "capacity": p.get("capacity", "internal_operator"),
                "client_acceptance": False,
                "sequence": int(self.db.execute("SELECT value FROM meta WHERE key='sequence'").fetchone()[0]) + 1}
        return self._save("review", self._id(req["operation_id"], "review"), None, body)

    def _crosswalk(self, p, req):
        edition = self._edition(p.get("edition_id"))
        row_ids = p.get("observation_row_ids")
        require(isinstance(row_ids, list) and row_ids and len(set(row_ids)) == len(row_ids), "crosswalk", "Select unique original observations.")
        rows = {r["row_id"]: r for r in self._rows(edition["id"])}
        require(all(i in rows for i in row_ids), "crosswalk", "A selected observation is absent.")
        require(p.get("decision") in {"same_asset", "distinct_assets", "unresolved", "rejected"}
                and isinstance(p.get("note"), str) and p["note"].strip(), "crosswalk", "Record the explicit identity decision and evidence.")
        canonical = p.get("canonical_asset_id")
        if p["decision"] == "same_asset":
            identifier(canonical, "Selected canonical asset ID")
        object_id = p.get("id") or self._id(req["operation_id"], "crosswalk")
        body = {"edition_id": edition["id"], "edition_sha256": edition["sha256"],
                "observations": [{"row_id": i, "sha256": rows[i]["sha256"]} for i in row_ids],
                "canonical_asset_id": canonical, "decision": p["decision"], "note": p["note"],
                "actor": req["actor"], "created_at": now(),
                "effect": "Recorded decision only. Original register rows and their issues are unchanged."}
        return self._save("crosswalk", object_id, p.get("expected_version"), body)

    def _prepare_exchange(self, p, req):
        edition = self._edition(p.get("edition_id"))
        require(edition["intake_complete"], "exchange", "Complete the selected source parse.")
        table = p.get("table")
        require(table in TABLES, "exchange", "Select a known original register.")
        keys, editable, guards = p.get("key_fields"), p.get("editable_fields"), p.get("guard_fields")
        require(isinstance(keys, list) and keys and set(keys) <= set(TABLES[table]["fields"]), "exchange", "Select original key fields.")
        require(isinstance(editable, list) and isinstance(guards, list)
                and set(editable) <= set(TABLES[table]["fields"])
                and set(guards) <= set(TABLES[table]["fields"])
                and not set(editable) & (set(keys) | set(guards)), "exchange", "Editable fields must not include identifiers or guards.")
        require(p.get("model_name") and p.get("model_version") and p.get("method_note"),
                "model_authority", "Name the actual selected existing model, version and authorized exchange method.")
        files = [self._file(i) for i in p.get("model_file_ids", [])]
        require(files, "model_files", "Retain the original model/export files before preparing an exchange.")
        rows = list(self._rows(edition["id"], table))
        exported = {"schema": "lake-county.original-model-exchange/v1", "edition_id": edition["id"],
                    "edition_sha256": edition["sha256"], "table": table, "key_fields": keys,
                    "editable_fields": editable, "guard_fields": guards,
                    "model": {"name": p["model_name"], "version": p["model_version"],
                              "method_note": p["method_note"], "files": files},
                    "records": [{"row_id": r["row_id"], "values": r["values"]} for r in rows],
                    "notice": "The original model is authoritative. This file is a source-bound exchange; it does not recalculate proprietary formulas."}
        raw = (stable(exported) + "\n").encode()
        pin = self._retain(raw)
        file_id = self._id(req["operation_id"], "exchange-file")
        self.db.execute("INSERT INTO files VALUES(?,?,?,?,?,?,?)",
                        (file_id, pin["sha256"], pin["bytes"], "original-model-exchange.json", "application/json",
                         stable({"source_kind": "prepared_exchange", "authority": "selected_original_model"}), now()))
        body = {**exported, "prepared_file_id": file_id, "candidate": None, "comparison": None, "adoption": None,
                "actor": req["actor"], "created_at": now()}
        return self._save("exchange", self._id(req["operation_id"], "exchange"), None, body)

    def _return_exchange(self, p, req):
        prior = self._object("exchange", p.get("id"), p.get("expected_version"))
        body = prior["body"]
        edition = self._edition(p.get("candidate_edition_id"))
        table = p.get("table", body["table"])
        require(table == body["table"], "exchange", "Return to the original selected register.")
        for f in body["model"]["files"]:
            require(self._file(f["id"])["sha256"] == f["sha256"], "model_integrity", "Original model file changed.")
        before, after = list(self._rows(body["edition_id"], table)), list(self._rows(edition["id"], table))
        comparison = compare_records(before, after, body["key_fields"], body["guard_fields"], body["editable_fields"])
        errors = [{"row_id": r["row_id"], "issues": r["issues"]} for r in after if any(i["severity"] == "error" for i in r["issues"])]
        comparison["structural_errors"] = errors
        comparison["adoptable"] = comparison["adoptable"] and edition["intake_complete"] and not errors
        next_body = {**body, "candidate": {"edition_id": edition["id"], "sha256": edition["sha256"],
                     "row_ids": [r["row_id"] for r in after]}, "comparison": comparison,
                     "comparison_sha256": digest(comparison), "adoption": None, "returned_at": now()}
        return self._save("exchange", prior["id"], p["expected_version"], next_body)

    def _adopt_exchange(self, p, req):
        prior = self._object("exchange", p.get("id"), p.get("expected_version"))
        body = prior["body"]
        require(body.get("comparison") and body["comparison_sha256"] == p.get("comparison_sha256"),
                "exchange_review", "Review the exact complete returned-file comparison.", status=409)
        require(p.get("status") in {"accepted", "kept_original", "rejected"} and p.get("note"),
                "exchange_review", "Record the actual adoption decision and reason.")
        if p["status"] == "accepted":
            require(body["comparison"]["adoptable"], "exchange_blocked", "Resolve missing/duplicate keys, guards and structural errors before adoption.")
        adoption = {"status": p["status"], "comparison_sha256": body["comparison_sha256"], "actor": req["actor"],
                    "note": p["note"], "created_at": now(),
                    "row_ids": body["candidate"]["row_ids"] if p["status"] == "accepted" else [],
                    "edition_id": body["candidate"]["edition_id"] if p["status"] == "accepted" else body["edition_id"]}
        return self._save("exchange", prior["id"], p["expected_version"], {**body, "adoption": adoption})

    def _scenario(self, p, req):
        spec = p.get("spec")
        require(isinstance(spec, dict), "scenario", "Supply the complete selected scenario.")
        edition = self._edition(spec.get("edition_id"))
        require(edition["intake_complete"], "scenario", "A partial structural source edition cannot produce a complete scenario.")
        exchange = None
        if spec.get("mode") == "received_model":
            selected = spec.get("model_exchange")
            require(isinstance(selected, dict) and set(selected) == {"id", "revision", "sha256"}, "model_exchange", "Pin the exact accepted exchange version.")
            exchange = self._object("exchange", selected["id"], selected["revision"])
            require(exchange["sha256"] == selected["sha256"], "model_exchange", "Selected exchange hash differs.")
            require(exchange["body"].get("adoption", {}).get("edition_id") == edition["id"],
                    "model_exchange", "The scenario source edition differs from the accepted model return.")
        result = evaluate_scenario(spec, list(self._rows(edition["id"])),
                    source_edition={"id": edition["id"], "sha256": edition["sha256"]},
                    model_exchange=None if exchange is None else {"id": exchange["id"], **exchange["body"]})
        body = {"spec": spec, "result": result, "source_edition_sha256": edition["sha256"],
                "actor": req["actor"], "created_at": now()}
        object_id = p.get("id") or self._id(req["operation_id"], "scenario")
        return self._save("scenario", object_id, p.get("expected_version"), body)

    def _reviews(self):
        return [self._object("review", row["id"], row["revision"])["body"]
                for row in self.db.execute("SELECT * FROM heads WHERE kind='review' ORDER BY id")]

    def _accepted(self, kind, object_id, sha):
        rows = [r for r in self._reviews() if r["subject_kind"] == kind and r["subject_id"] == object_id and r["subject_sha256"] == sha]
        return bool(rows) and sorted(rows, key=lambda r: r["sequence"])[-1]["status"] == "accepted"

    def _publish(self, p, req):
        edition = self._edition(p.get("edition_id"))
        kind = p.get("kind")
        require(kind in {"internal_working", "reviewed_handover"}, "publication", "Choose internal working or reviewed handover.")
        selected = p.get("scenarios", [])
        require(isinstance(selected, list) and len(selected) <= 3, "publication", "Select the baseline and up to two reviewed alternatives.")
        scenarios, seen = [], set()
        for pin in selected:
            require(isinstance(pin, dict) and set(pin) == {"id", "revision", "sha256"}, "publication", "Pin each complete scenario version.")
            obj = self._object("scenario", pin["id"], pin["revision"])
            require(obj["sha256"] == pin["sha256"] and obj["id"] not in seen, "publication", "Scenario selection is stale or duplicated.")
            seen.add(obj["id"])
            require(obj["body"]["spec"]["edition_id"] == edition["id"], "publication", "All selected scenarios must use the selected edition.")
            scenarios.append(obj)
        if kind == "reviewed_handover":
            require(edition["client_records_present"] and self._accepted("edition", edition["id"], edition["sha256"]),
                    "handover", "Reviewed handover requires the supplied asset source edition and its actual acceptance.")
            require(scenarios and all(s["body"]["result"]["complete"] and self._accepted("scenario", s["id"], s["sha256"]) for s in scenarios),
                    "handover", "Complete and explicitly review each selected scenario before a reviewed handover.")
        body = {"id": self._id(req["operation_id"], "publication"), "name": p.get("name") or "Capital programme",
                "kind": kind, "context": self.context, "edition": edition, "scenarios": scenarios,
                "rows": list(self._rows(edition["id"])), "reviews": self._reviews(),
                "crosswalks": [self._object("crosswalk", r["id"], r["revision"]) for r in self.db.execute("SELECT * FROM heads WHERE kind='crosswalk'")],
                "created_at": now(), "actor": req["actor"], "client_acceptance": False,
                "professional_authority": "FEA and the selected original model; no appraisal or condition finding is generated.",
                "missing_client_inputs": not edition["client_records_present"]}
        return self._save("publication", body["id"], None, body)

    def report(self, publication_id, revision=None):
        with self.lock():
            obj = self._object("publication", publication_id, revision)
            return render_report(obj)

    def export_workspace(self, destination, *, publication_id=None, application_root=None):
        """Full closed source/runtime/database archive from one locked native snapshot."""
        destination = Path(destination)
        app = Path(application_root or Path(__file__).parent).resolve()
        with self.lock():
            revision, context = self.revision(), dict(self.context)
            publication = self._object("publication", publication_id) if publication_id else None
            stage = Path(tempfile.mkdtemp(prefix="fea-export-", dir=self.root.parent))
            try:
                snapshot = stage / "workspace.sqlite3"
                copy = sqlite3.connect(snapshot)
                try:
                    self.db.backup(copy)
                finally:
                    copy.close()
                members = {"workspace/workspace.sqlite3": snapshot}
                initialization = self.root / "initialization.json"
                if initialization.is_file():
                    members["workspace/initialization.json"] = initialization
                for row in self.db.execute("SELECT DISTINCT sha256,bytes FROM files"):
                    original = self._blob(row["sha256"])
                    require(file_identity(original) == {"sha256": row["sha256"], "bytes": row["bytes"]},
                            "source_integrity", "A source file is unavailable for the complete handover.")
                    members["workspace/objects/" + row["sha256"][:2] + "/" + row["sha256"]] = original
                for relative in RUNTIME_FILES:
                    path = app / relative
                    require(path.is_file() and not path.is_symlink(), "application_closure", "A complete selected application file is missing.", {"path": relative})
                    members["application/" + relative] = path
                if publication:
                    raw = (stable(publication) + "\n").encode()
                    atomic(stage / "publication.json", raw)
                    atomic(stage / "report.html", render_report(publication).encode())
                    members["delivery/publication.json"] = stage / "publication.json"
                    members["delivery/report.html"] = stage / "report.html"
                    for table in TABLES:
                        output = io.StringIO(newline="")
                        fields = ["row_id", "file_id", "source_row", "physical_line", "raw_json", "values_json", "issues_json"]
                        writer = csv.DictWriter(output, fields)
                        writer.writeheader()
                        for row in publication["body"]["rows"]:
                            if row["table"] == table:
                                writer.writerow({"row_id": row["row_id"], "file_id": row["file_id"], "source_row": row["source_row"],
                                    "physical_line": row["physical_line"], "raw_json": stable(row["raw"]),
                                    "values_json": stable(row["values"]), "issues_json": stable(row["issues"])})
                        atomic(stage / (table + ".csv"), output.getvalue().encode())
                        members["delivery/" + table + ".csv"] = stage / (table + ".csv")
                entries = [{"path": name, **file_identity(path)} for name, path in sorted(members.items())]
                manifest = {"schema": "lake-county.complete-workspace-archive/v1", "origin": context,
                    "workspace_revision": revision, "created_at": now(),
                    "selected_publication": None if publication is None else {k: publication[k] for k in ("id", "revision", "sha256")},
                    "members": entries, "application_files": list(RUNTIME_FILES),
                    "notice": "Full source, prior versions and request history are included. Receiving preserves the original native workspace identity."}
                archive = stage / "complete.zip"
                with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                    for name, path in sorted(members.items()):
                        z.write(path, name)
                    z.writestr("manifest.json", stable(manifest) + "\n")
                require(archive.stat().st_size <= MAX_ARCHIVE, "archive_limit", "The complete archive exceeds the declared 512 MiB limit.")
                identity = file_identity(archive)
                atomic(destination, archive.read_bytes())
                return {"schema": "lake-county.workspace-export-receipt/v1", "path": str(destination.resolve()),
                        **identity, "manifest_sha256": digest(manifest), "members": len(entries),
                        "workspace_id": context["workspace_id"], "workspace_revision": revision,
                        "selected_publication": manifest["selected_publication"]}
            finally:
                shutil.rmtree(stage)

def rename_new_directory(source, destination):
    """Linux renameat2(RENAME_NOREPLACE), never ordinary overwrite-capable rename."""
    import ctypes
    import errno
    library = ctypes.CDLL(None, use_errno=True)
    method = getattr(library, "renameat2", None)
    require(method is not None, "platform", "This receiving path requires Linux renameat2 no-replace.")
    result = method(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    if result:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise ProgrammeError("destination_exists", "Original destination already exists; inspect it before receiving.", status=409)
        raise OSError(code, os.strerror(code))
    descriptor = os.open(Path(destination).parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def receive_workspace(archive, destination, *, expected_sha256, expected_bytes):
    archive, destination = Path(archive), Path(destination).resolve()
    receipt_name = destination.parent / (destination.name + ".receiving.json")
    prior = None
    if receipt_name.is_file():
        prior = json.loads(receipt_name.read_text())
        require(prior.get("schema") == "lake-county.workspace-receiving/v1"
                and prior["archive_sha256"] == expected_sha256 and prior["archive_bytes"] == expected_bytes
                and prior["destination"] == str(destination),
                "receiving_conflict", "This receiving operation is bound to another original archive or destination.", status=409)
        if prior.get("complete"):
            require(destination.is_dir(), "receiving_missing", "The completed receiving destination is absent.")
            w = Workspace(destination / "workspace")
            try:
                require(w.context["workspace_id"] == prior["workspace_id"], "receiving_identity", "The received native identity differs.")
            finally:
                w.close()
            return prior
    require(file_identity(archive) == {"sha256": expected_sha256, "bytes": expected_bytes},
            "archive_identity", "Selected archive bytes do not match the original delivery receipt.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if prior is None:
        require(not destination.exists(), "destination_exists", "No current workspace is overwritten.", status=409)
        stage = destination.parent / (destination.name + ".receiving-" + uuid.uuid4().hex)
        prior = {"schema": "lake-county.workspace-receiving/v1", "archive_sha256": expected_sha256,
                 "archive_bytes": expected_bytes, "destination": str(destination), "stage": str(stage),
                 "complete": False, "created_at": now(), "receiver_id": str(uuid.uuid4())}
        atomic(receipt_name, stable(prior).encode())
    stage = Path(prior["stage"])
    require(stage.parent == destination.parent and stage.name.startswith(destination.name + ".receiving-")
            and not stage.is_symlink(), "receiving_stage", "Retain the originally selected receiving stage.")
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        require(len(infos) <= 100000 and len({i.filename for i in infos}) == len(infos), "archive_members", "Archive contains duplicate or excessive members.")
        require(sum(i.file_size for i in infos) <= MAX_ARCHIVE, "archive_limit", "Uncompressed archive exceeds 512 MiB.")
        for item in infos:
            safe_relative(item.filename)
            require(not item.is_dir() and ((item.external_attr >> 16) & 0o170000) != 0o120000,
                    "archive_member", "Only regular files are accepted.")
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
        require(manifest.get("schema") == "lake-county.complete-workspace-archive/v1", "archive_schema", "Use the complete native workspace archive.")
        entries = manifest.get("members")
        require(isinstance(entries, list) and len({x["path"] for x in entries}) == len(entries), "archive_manifest", "Manifest members must be unique.")
        require(set(z.namelist()) == {"manifest.json"} | {x["path"] for x in entries}, "archive_manifest", "Archive members differ from the full declared selection.")
        require(set(manifest.get("application_files", [])) == set(RUNTIME_FILES), "application_closure", "The complete runtime selection is required.")
        require({"workspace/workspace.sqlite3"} | {"application/" + p for p in RUNTIME_FILES} <= {x["path"] for x in entries},
                "application_closure", "The declared application or native database is missing.")
        if destination.exists():
            require(prior.get("stage_identity") and not stage.exists(), "receiving_collision", "A different destination appeared during receiving.", status=409)
            identity = {"device": destination.stat().st_dev, "inode": destination.stat().st_ino}
            require(identity == prior["stage_identity"], "receiving_collision", "The destination is not the original published stage.", status=409)
            selected_root = destination
        else:
            if not stage.exists():
                require(not prior.get("stage_identity"), "receiving_stage_missing", "The sealed original receiving stage is absent.")
                stage.mkdir(mode=0o700)
            selected_root = stage
        for entry in entries:
            safe_relative(entry["path"])
            raw = z.read(entry["path"])
            require(len(raw) == entry["bytes"] and digest(raw) == entry["sha256"], "archive_member_identity", "An original archive member differs.", {"path": entry["path"]})
            path = selected_root / entry["path"]
            if selected_root == destination or prior.get("stage_identity"):
                require(file_identity(path) == {"bytes": entry["bytes"], "sha256": entry["sha256"]},
                        "receiving_later_edit", "A sealed receiving member changed. Preserve current and original copies for explicit review.", {"path": entry["path"]}, 409)
            else:
                atomic(path, raw)
        atomic(selected_root / "manifest.json", (stable(manifest) + "\n").encode())
    w = Workspace(selected_root / "workspace")
    try:
        require(w.context == manifest["origin"] and w.revision() == manifest["workspace_revision"],
                "receiving_identity", "Received native workspace does not match the original selection.")
        for row in w.db.execute("SELECT id FROM files"):
            w._file(row[0])
        if manifest.get("selected_publication"):
            pin = manifest["selected_publication"]
            require(w._object("publication", pin["id"], pin["revision"])["sha256"] == pin["sha256"],
                    "publication_identity", "The frozen selected publication differs after receiving.")
        workspace_id = w.context["workspace_id"]
    finally:
        w.close()
    sealed = {**prior, "workspace_id": workspace_id, "workspace_revision": manifest["workspace_revision"],
              "manifest_sha256": digest(manifest), "stage_identity": {"device": selected_root.stat().st_dev, "inode": selected_root.stat().st_ino}}
    atomic(receipt_name, stable(sealed).encode(), replace=True)
    if selected_root == stage:
        rename_new_directory(stage, destination)
    complete = {**sealed, "complete": True, "completed_at": now()}
    atomic(receipt_name, stable(complete).encode(), replace=True)
    return complete

def render_report(publication):
    p = publication["body"]
    escape = lambda x: html.escape("" if x is None else str(x))
    title = escape(p["name"])
    state = "Reviewed engineering handover" if p["kind"] == "reviewed_handover" else "Internal working source and planning package"
    cards = []
    for scenario in p["scenarios"]:
        result = scenario["body"]["result"]
        heading = "".join("<th>" + escape(x.replace("_", " ")) + "</th>" for x in
                          ("year", "capital_need", "planned_expenditure", "authorized_funding", "contingent_funding", "cash_receipt", "cash_payment", "closing_cash"))
        lines = []
        for row in result["years"]:
            lines.append("<tr>" + "".join("<td>" + escape(row.get(k) if row.get(k) is not None else "Unknown") + "</td>" for k in
                         ("year", "capital_need", "planned_expenditure", "authorized_funding", "contingent_funding", "cash_receipt", "cash_payment", "closing_cash")) + "</tr>")
        problems = result["required_inputs"] + [x["reason"] for x in result["unresolved"]]
        cards.append("<section><h2>" + escape(result["name"]) + "</h2><p>" + escape(result["mode"]) + " · " + escape(result["currency"]) +
                     " · " + escape(result["price_basis"]) + "</p><div class='scroll'><table><thead><tr>" + heading +
                     "</tr></thead><tbody>" + "".join(lines) + "</tbody></table></div><h3>Unresolved inputs</h3><ul>" +
                     "".join("<li>" + escape(x) + "</li>" for x in problems) + "</ul><p>" + escape(result["cash_note"]) + "</p></section>")
    history = [row for row in p["rows"] if row["table"] == "capital_rollforward"]
    if history:
        fields=("asset_class","measure_basis","row_role","opening","additions","deletions","closing")
        header="".join("<th>"+escape(field.replace("_"," "))+"</th>" for field in fields)
        body="".join("<tr>"+"".join("<td>"+escape(row["values"].get(field))+"</td>" for field in fields)+"</tr>" for row in history)
        cards.insert(0,"<section><h2>Selected historical capital-asset rollforward</h2>"
            "<p>Original accounting categories and component/summary roles are retained. "
            "These historical balances are separate from asset-specific appraisal, future replacement need, funding and cash.</p>"
            "<div class='scroll'><table><thead><tr>"+header+"</tr></thead><tbody>"+body+"</tbody></table></div></section>")
    sources = "".join("<tr><td>" + escape(s["file_id"]) + "</td><td>" + escape(s["table"]) + "</td><td>" + escape(s["sha256"]) +
                      "</td><td>" + escape(s["bytes"]) + "</td></tr>" for s in p["edition"]["selections"])
    issues = [dict(row_id=r["row_id"], table=r["table"], source_row=r["source_row"], **issue)
              for r in p["rows"] for issue in r["issues"]]
    return ("""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + title + """</title><style>body{font:16px/1.6 system-ui;color:#17372f;background:#f6f8f5;margin:0}
main{max-width:1100px;margin:auto;padding:40px 24px}section{background:white;padding:24px;margin:24px 0;border:1px solid #d4dfd8;border-radius:12px}
h1{font-size:36px;line-height:1.15}h2{font-size:24px}small,code{overflow-wrap:anywhere}.state{padding:14px;background:#fff0c9;border-left:4px solid #c38e23}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border-bottom:1px solid #d4dfd8;overflow-wrap:anywhere}
.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#536a62}@media print{body{background:white}section{break-inside:avoid;border:0;padding:0}.scroll{overflow:visible}main{padding:0}}</style><main>
<p class="muted">Lake County, Colorado · FEA proposed workshare</p><h1>""" + title + """</h1><p class="state">""" + escape(state) + """</p>
<p>No accepted County contract or client approval is represented. Professional findings, valuations and the selected existing model remain FEA-owned inputs.</p>
<section><h2>Selected source</h2><p>""" + escape(p["edition"]["name"]) + """</p><p>Client asset register present: """ + escape(p["edition"]["client_records_present"]) + """</p>
<p>Exact source rows: """ + escape(sum(p["edition"]["counts"].values())) + """ · Findings retained: """ + escape(len(issues)) + """</p>
<table><tr><th>Original file</th><th>Register</th><th>SHA-256</th><th>Bytes</th></tr>""" + sources + """</table></section>""" + "".join(cards) + """
<section><h2>Complete exception register</h2><p>Every original row remains in the native archive and editable register exports.</p><pre>""" + escape(json.dumps(issues, ensure_ascii=False, indent=2)) + """</pre></section>
<section><h2>Decisions and review</h2><pre>""" + escape(json.dumps(p["reviews"], ensure_ascii=False, indent=2)) + """</pre></section>
<footer><small>Original case """ + escape(p["context"]["case_id"]) + """ · publication """ + escape(publication["id"]) + """ / """ + escape(publication["revision"]) +
"""<br>Source packet """ + escape(p["context"]["packet_sha256"]) + """<br>Publication SHA-256 """ + escape(publication["sha256"]) + """</small></footer></main></html>""")
