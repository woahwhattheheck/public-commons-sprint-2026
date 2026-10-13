"""Complete Analysis query-export publication recipes and retained packages.

The original Analysis job owner performs preparation. QueryExport owns source
verification and SQLite value encodings; the Frictionless workbench/publisher
remains the authority for source review, capture, plans and merchant release.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import stat
import threading
import uuid
import zipfile

from .analysis_publication_package import normalize_recipe, build_package, open_package
from .errors import BuyerError, StateError
from .query_export import QueryExport
from .storage import digest, dump, parse, private_directory, read, write

SCHEMA = "stellar-forge.analysis-dataset-publications.v1"
INDEX_SCHEMA = "stellar-forge.analysis-dataset-publication-downloads.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_SHA = re.compile(r"[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_MANIFEST_LIMIT = 32 * 1024 * 1024
_INDEX_LIMIT = 20 * 1024 * 1024
_MAX_PREVIEW_BYTES = 256 * 1024
_FILES = {
    "datapackage.json": ("package/datapackage.json", "application/json", "public"),
    "data.json": ("package/data.json", "application/json", "public"),
    "publication.zip": ("publication.zip", "application/zip", "public"),
    "recipe.json": ("recipe.json", "application/json", "private"),
    "manifest.json": ("manifest.json", "application/json", "private"),
    "report.html": ("report.html", "text/html;charset=utf-8", "private"),
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _need(value, code):
    if not value:
        raise StateError("ANALYSIS_PUBLICATION_" + code)


def _id(value):
    _need(isinstance(value, str) and _ID.fullmatch(value), "ID_INVALID")
    return value


def _sha(value):
    _need(isinstance(value, str) and _SHA.fullmatch(value), "DIGEST_INVALID")
    return value


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"), sort_keys=True).encode("utf-8")


def _fields(value, required, optional=()):
    _need(isinstance(value, dict) and set(required) <= set(value)
          and not set(value) - set(required) - set(optional), "FIELDS_INVALID")


def _page(before, limit):
    _need(type(limit) is int and 1 <= limit <= 100
          and (before is None or type(before) is int and before > 0), "PAGE_INVALID")


@contextmanager
def _verified_file(path, record, cancelled=lambda: False):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags)
    try:
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
              and not info.st_mode & 0o077
              and (not hasattr(os, "getuid") or info.st_uid == os.getuid()),
              "PRIVATE_FILE_REQUIRED")
        _need(info.st_size == record["bytes"], "FILE_CHANGED")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            total, checksum = 0, hashlib.sha256()
            while chunk := stream.read(1024 * 1024):
                _need(not cancelled(), "CANCELLED")
                total += len(chunk)
                _need(total <= record["bytes"], "FILE_CHANGED")
                checksum.update(chunk)
            _need(total == record["bytes"] and checksum.hexdigest() == record["sha256"],
                  "FILE_CHANGED")
            stream.seek(0)
            yield stream
    finally:
        os.close(fd)


def _record_bytes(value, mime, visibility):
    return {"bytes": len(value), "sha256": digest(value), "mime": mime,
            "visibility": visibility}


def _publish_bytes(path, value):
    """Keep an already-published exact member and its original identity."""
    try:
        write(path, value, exclusive=True)
    except FileExistsError:
        _need(read(path, len(value) + 1) == value, "PUBLISHED_FILE_CHANGED")


def _zip_member(name):
    result = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    result.create_system = 3
    result.external_attr = 0o600 << 16
    result.compress_type = zipfile.ZIP_DEFLATED
    return result


class AnalysisPublications:
    """Saved recipes and files beside the original analytical database."""

    def __init__(self, workspace, *, connections=None):
        self.workspace = workspace
        self.database = workspace.database
        self.directory = private_directory(self.database.directory / "analysis-publications")
        self.packages = private_directory(self.directory / "packages")
        self._condition = threading.Condition(threading.RLock())
        self._active = {}
        self._closed = False
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_publication_recipes("
                       "sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,"
                       "revision INTEGER NOT NULL,created_at TEXT NOT NULL,request TEXT NOT NULL,"
                       "request_sha256 TEXT NOT NULL,recipe TEXT NOT NULL,recipe_sha256 TEXT NOT NULL,"
                       "source TEXT NOT NULL,UNIQUE(name,revision))")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_publication_heads("
                       "name TEXT PRIMARY KEY,revision INTEGER NOT NULL,recipe_id TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_publication_observations("
                       "sequence INTEGER PRIMARY KEY,job_id TEXT NOT NULL,kind TEXT NOT NULL,"
                       "observed_at TEXT NOT NULL,record TEXT NOT NULL)")
            db.commit()
        self.recover_completed()
        from .analysis_publication_source import PublicationSource
        self.sources = PublicationSource(self, connections=connections)

    def configuration(self):
        return {**self.sources.configuration(),
                "representations": ["text", "integer", "number", "boolean01", "integer-text",
                                    "sqlite-json", "base64"],
                "public_files": ["datapackage.json", "data.json", "publication.zip"],
                "private_files": ["recipe.json", "manifest.json", "report.html"],
                "max_resource_bytes": 256 * 1024 * 1024,
                "max_native_projection_fields": 64}

    @contextmanager
    def _operation(self, job_id=None):
        token, event = uuid.uuid4().hex, threading.Event()
        with self._condition:
            _need(not self._closed, "CLOSED")
            self._active[token] = (job_id, event)
        try:
            if job_id is not None and self._cancel_requested(job_id):
                event.set()
            yield event
        finally:
            with self._condition:
                self._active.pop(token, None)
                self._condition.notify_all()

    def close(self):
        with self._condition:
            self._closed = True
            for _, event in self._active.values():
                event.set()
            while self._active:
                self._condition.wait()

    @staticmethod
    def _stop(event):
        _need(not event.is_set(), "CANCELLED")

    def _source(self, export_id, expected_sha256=None, *, inspect=True):
        export_id = _id(export_id)
        job = self.workspace._job(export_id)
        _need(job["kind"] == "query-export" and job["status"] == "COMPLETE"
              and isinstance(job.get("result"), dict), "COMPLETE_QUERY_EXPORT_REQUIRED")
        native = job["result"]
        checksum = _sha(native.get("manifest_sha256"))
        if expected_sha256 is not None:
            _need(checksum == _sha(expected_sha256), "SOURCE_CHANGED")
        reader = QueryExport(self.workspace.exports.directory / export_id)
        raw = reader.manifest_bytes
        _need(digest(raw) == checksum and reader.manifest == native.get("manifest")
              and raw.decode("utf-8") == native.get("manifest_text"), "SOURCE_CHANGED")
        manifest = reader.inspect() if inspect else reader.manifest
        _need(manifest.get("queryComplete") is True
              and "rows.jsonl" in manifest["outputs"], "TYPED_FULL_EXPORT_REQUIRED")
        source = {
            "workspace_id": self.workspace.identity,
            "query_export_id": export_id,
            "manifest_sha256": checksum,
            "binding_sha256": manifest["bindingSha256"],
            "row_count": manifest["rowCount"],
            "columns": manifest["columns"],
            "binding": manifest["binding"],
            "created_at": manifest["createdAt"],
            "source_query": deepcopy(native["source_query"]),
            "files": deepcopy(native["files"]),
        }
        return reader, source, job

    def exports(self, *, before=None, limit=25):
        with self._operation():
            return self.workspace.exports.history(before=before, limit=limit)

    def review(self, export_id, *, manifest_sha256=None, sample_rows=20):
        _need(type(sample_rows) is int and 0 <= sample_rows <= 100, "PREVIEW_LIMIT_INVALID")
        with self._operation() as event:
            reader, source, job = self._source(export_id, manifest_sha256)
            preview, total = [], 0
            if sample_rows:
                rows = reader.encoded_rows()
                try:
                    for row in rows:
                        self._stop(event)
                        size = len(_json(row))
                        if len(preview) >= sample_rows or total + size > _MAX_PREVIEW_BYTES:
                            break
                        preview.append(row)
                        total += size
                finally:
                    rows.close()
            self._stop(event)
            return {"schema": SCHEMA, "workspace_id": self.workspace.identity,
                    "source": source, "label": job["result"]["label"],
                    "preview": {"rows": preview, "returned": len(preview),
                                "total_rows": source["row_count"],
                                "complete": len(preview) == source["row_count"],
                                "encoding": "sqlite-scalars-v1"},
                    "representations": [
                        "text", "integer", "number", "boolean01",
                        "integer-text", "sqlite-json", "base64"]}

    @staticmethod
    def _recipe_view(row):
        result = dict(row)
        result["recipe"] = parse(result["recipe"].encode("utf-8"))
        result["source"] = parse(result["source"].encode("utf-8"))
        result.pop("request", None)
        result.pop("request_sha256", None)
        return result

    def _recipe_row(self, db, recipe_id):
        row = db.execute("SELECT * FROM sf_analysis_publication_recipes WHERE id=?",
                         (_id(recipe_id),)).fetchone()
        _need(row is not None, "RECIPE_NOT_FOUND")
        value = self._recipe_view(row)
        _need(digest(_json(value["recipe"])) == value["recipe_sha256"], "RECIPE_CHANGED")
        return value

    def recipe(self, recipe_id):
        with self._operation():
            with self.database._connection(readonly=True) as db:
                result = self._recipe_row(db, recipe_id)
                head = db.execute("SELECT revision,recipe_id FROM sf_analysis_publication_heads WHERE name=?",
                                  (result["name"],)).fetchone()
            result["head"] = dict(head) if head else None
            return result

    def recipes(self, *, before=None, limit=25):
        _page(before, limit)
        with self._operation():
            with self.database._connection(readonly=True) as db:
                rows = db.execute("SELECT * FROM sf_analysis_publication_recipes "
                                  "WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                                  (before, before, limit + 1)).fetchall()
                heads = {row["name"]: dict(row) for row in
                         db.execute("SELECT * FROM sf_analysis_publication_heads")}
                values = [self._recipe_view(row) for row in rows[:limit]]
            for value in values:
                value["head"] = heads.get(value["name"])
            return {"items": values, "next_before": values[-1]["sequence"]
                    if len(rows) > limit else None}

    def save_recipe(self, request):
        _fields(request, {"id", "name", "expected_revision", "recipe"})
        request_id = _id(request["id"])
        name = request["name"]
        _need(isinstance(name, str) and _NAME.fullmatch(name), "NAME_INVALID")
        expected = request["expected_revision"]
        _need(type(expected) is int and expected >= 0, "REVISION_INVALID")
        raw, checksum = _json(request), digest(_json(request))
        _need(len(raw) <= 1024 * 1024, "REQUEST_TOO_LARGE")
        with self._operation() as event:
            # An exact saved decision reopens before current source availability
            # or head revisions are consulted.
            with self.database._connection(readonly=True) as db:
                old = db.execute("SELECT * FROM sf_analysis_publication_recipes WHERE id=?",
                                 (request_id,)).fetchone()
                if old is not None:
                    _need(old["request_sha256"] == checksum and old["request"] == raw.decode("utf-8"),
                          "REQUEST_ID_REUSED")
                    return self._recipe_view(old)
            value = request["recipe"]
            _need(isinstance(value, dict), "RECIPE_INVALID")
            reader, source, _ = self._source(value.get("query_export_id"),
                                              value.get("manifest_sha256"))
            normalized = normalize_recipe(value, columns=source["columns"])
            _need(normalized["workspace_id"] == self.workspace.identity
                  and normalized["query_export_id"] == source["query_export_id"]
                  and normalized["manifest_sha256"] == source["manifest_sha256"],
                  "SOURCE_CHANGED")
            recipe_raw = _json(normalized)
            self._stop(event)
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT * FROM sf_analysis_publication_recipes WHERE id=?",
                                 (request_id,)).fetchone()
                if old is not None:
                    _need(old["request_sha256"] == checksum and old["request"] == raw.decode("utf-8"),
                          "REQUEST_ID_REUSED")
                    db.commit()
                    return self._recipe_view(old)
                head = db.execute("SELECT revision FROM sf_analysis_publication_heads WHERE name=?",
                                  (name,)).fetchone()
                revision = head["revision"] if head else 0
                _need(revision == expected, "REVISION_CHANGED")
                self._stop(event)
                db.execute("INSERT INTO sf_analysis_publication_recipes"
                           "(id,name,revision,created_at,request,request_sha256,recipe,recipe_sha256,source)"
                           " VALUES(?,?,?,?,?,?,?,?,?)",
                           (request_id, name, revision + 1, _now(), raw.decode("utf-8"),
                            checksum, recipe_raw.decode("utf-8"), digest(recipe_raw),
                            _json(source).decode("utf-8")))
                db.execute("INSERT INTO sf_analysis_publication_heads VALUES(?,?,?) "
                           "ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,recipe_id=excluded.recipe_id",
                           (name, revision + 1, request_id))
                result = self._recipe_row(db, request_id)
                db.commit()
                return result

    def prepare(self, request):
        _fields(request, {"id", "recipe_id", "recipe_sha256"})
        _id(request["id"])
        value = {"recipe_id": _id(request["recipe_id"]),
                 "recipe_sha256": _sha(request["recipe_sha256"])}
        with self._operation():
            with self.database._connection(readonly=True) as db:
                self.validate(db, value)
            return value

    def validate(self, db, spec):
        value = self._recipe_row(db, spec["recipe_id"])
        _need(value["recipe_sha256"] == spec["recipe_sha256"], "RECIPE_CHANGED")
        return value

    @staticmethod
    def _observe(db, job_id, kind, record):
        db.execute("INSERT INTO sf_analysis_publication_observations"
                   "(job_id,kind,observed_at,record) VALUES(?,?,?,?)",
                   (_id(job_id), kind, _now(), _json(record).decode("utf-8")))

    def resume(self, db, spec):
        self.validate(db, spec)
        self._observe(db, spec["id"], "CONTINUE_REQUESTED",
                      {"recipe_id": spec["recipe_id"], "recipe_sha256": spec["recipe_sha256"]})

    def _cancel_requested(self, job_id):
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT kind FROM sf_analysis_publication_observations "
                             "WHERE job_id=? AND kind IN ('CANCEL_REQUESTED','CONTINUE_REQUESTED') "
                             "ORDER BY sequence DESC LIMIT 1", (_id(job_id),)).fetchone()
        return row is not None and row["kind"] == "CANCEL_REQUESTED"

    def progress(self, job_id):
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,kind,observed_at,record FROM "
                              "sf_analysis_publication_observations WHERE job_id=? "
                              "ORDER BY sequence DESC LIMIT 100", (_id(job_id),)).fetchall()
        values = [{**dict(row), "record": parse(row["record"].encode("utf-8"))}
                  for row in reversed(rows)]
        return {"job_id": job_id, "cancel_requested": self._cancel_requested(job_id),
                "observations": values}

    def cancel(self, job_id):
        job_id = _id(job_id)
        with self._operation():
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                job = db.execute("SELECT kind,status FROM sf_analysis_jobs WHERE id=?",
                                 (job_id,)).fetchone()
                _need(job is not None and job["kind"] in {"dataset-package", "dataset-source"}, "JOB_NOT_FOUND")
                if job["status"] == "RUNNING":
                    self._observe(db, job_id, "CANCEL_REQUESTED", {})
                db.commit()
            if job["status"] == "RUNNING":
                with self._condition:
                    for active_job, event in self._active.values():
                        if active_job == job_id:
                            event.set()
            return self.progress(job_id)

    def _directory(self, job_id):
        return self.packages / _id(job_id)

    def _manifest(self, job_id, recipe):
        directory = self._directory(job_id)
        manifest = open_package(directory, recipe_sha256=recipe["recipe_sha256"])
        source = recipe["source"]
        _need(manifest["recipe"] == recipe["recipe"]
              and manifest["recipe_sha256"] == recipe["recipe_sha256"], "PACKAGE_CHANGED")
        for key in ("workspace_id", "query_export_id", "manifest_sha256",
                    "binding_sha256", "row_count", "columns", "binding", "created_at"):
            _need(manifest["source"].get(key) == source.get(key), "SOURCE_CHANGED")
        return manifest

    def _report(self, job_id, recipe, manifest):
        esc = lambda value: html.escape(str(value), quote=True)
        fields = "".join("<tr><td>" + esc(v["source"]) + "</td><td>" + esc(v["name"])
                         + "</td><td>" + esc(v["representation"]) + "</td></tr>"
                         for v in manifest["recipe"]["fields"])
        source = manifest["source"]
        rows = [
            ("Analysis workspace", source["workspace_id"]),
            ("Original query export", source["query_export_id"]),
            ("Original manifest SHA-256", source["manifest_sha256"]),
            ("Full export binding SHA-256", source["binding_sha256"]),
            ("Prepared package job", job_id),
            ("Saved recipe", recipe["id"] + " / revision " + str(recipe["revision"])),
            ("Recipe SHA-256", recipe["recipe_sha256"]),
            ("Complete row count", source["row_count"]),
        ]
        facts = "".join("<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>" for k, v in rows)
        rights = esc(manifest["recipe"]["source_rights"])
        return ("<!doctype html><html lang=en><meta charset=utf-8>"
                "<meta name=viewport content='width=device-width,initial-scale=1'>"
                "<title>" + esc(manifest["recipe"]["title"]) + "</title>"
                "<style>body{font:16px/1.55 system-ui;margin:2rem auto;padding:0 1rem;"
                "max-width:70rem;color:#162128}h1{line-height:1.15}dd{margin:0 0 1rem;"
                "overflow-wrap:anywhere}dt{font-weight:650}table{border-collapse:collapse;"
                "width:100%}th,td{padding:.55rem;text-align:left;border-bottom:1px solid #ccd7dc;"
                "overflow-wrap:anywhere}code{overflow-wrap:anywhere}"
                "@media(max-width:500px){body{margin:1rem auto}table{font-size:.83rem}}</style>"
                "<h1>" + esc(manifest["recipe"]["title"]) + "</h1>"
                "<p>Prepared from the complete retained Analysis query export. "
                "The original Frictionless workbench performs source review, key validation, "
                "source selection and merchant publication.</p><dl>" + facts + "</dl>"
                "<h2>Explicit field representations</h2><table><thead><tr>"
                "<th>Original column</th><th>Published field</th><th>Representation</th>"
                "</tr></thead><tbody>" + fields + "</tbody></table>"
                "<h2>Operator source-rights record</h2><p>" + rights.replace("\n", "<br>") + "</p>"
                "<p>The distributable ZIP contains datapackage.json and data.json. "
                "This private report, recipe, SQL binding and original source history remain "
                "in the Analysis workspace handover.</p></html>").encode("utf-8")

    def _finish_files(self, job_id, recipe, manifest, event):
        directory = self._directory(job_id)
        records = {v["name"]: v for v in manifest["files"]}
        # The original complete package already exists; additional derived
        # downloads are deterministic and can be completed under the same job.
        report = self._report(job_id, recipe, manifest)
        self._stop(event)
        _publish_bytes(directory / "report.html", report)
        archive_path = directory / "publication.zip"
        temporary = directory / (".publication-" + uuid.uuid4().hex + ".tmp")
        archive_hash, archive_bytes = hashlib.sha256(), 0
        try:
            fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w+b") as output:
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=6, allowZip64=True) as archive:
                    for public_name, relative in (
                            ("datapackage.json", "package/datapackage.json"),
                            ("data.json", "package/data.json")):
                        self._stop(event)
                        record = records[relative]
                        with _verified_file(directory / relative, record, event.is_set) as stream:
                            with archive.open(_zip_member(public_name), "w", force_zip64=True) as member:
                                while chunk := stream.read(1024 * 1024):
                                    self._stop(event)
                                    member.write(chunk)
                output.flush()
                os.fsync(output.fileno())
                output.seek(0)
                while chunk := output.read(1024 * 1024):
                    self._stop(event)
                    archive_bytes += len(chunk)
                    archive_hash.update(chunk)
            self._stop(event)
            record = {"bytes": archive_bytes, "sha256": archive_hash.hexdigest(),
                      "mime": "application/zip", "visibility": "public"}
            try:
                os.link(temporary, archive_path)
            except FileExistsError:
                with _verified_file(archive_path, record, event.is_set):
                    pass
            fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)
        manifest_raw = read(directory / "manifest.json", _MANIFEST_LIMIT)
        items = []
        for name, (relative, mime, visibility) in _FILES.items():
            if name == "publication.zip":
                item = record
            elif name == "report.html":
                item = _record_bytes(report, mime, visibility)
            elif name == "manifest.json":
                item = _record_bytes(manifest_raw, mime, visibility)
            else:
                item = {k: records[relative][k] for k in ("bytes", "sha256")}
            items.append({"name": name, "relative": relative, **item,
                          "mime": mime, "visibility": visibility})
        index = {
            "schema": INDEX_SCHEMA, "workspace_id": self.workspace.identity,
            "job_id": job_id, "recipe_id": recipe["id"],
            "recipe_sha256": recipe["recipe_sha256"],
            "source": {k: manifest["source"][k] for k in (
                "workspace_id", "query_export_id", "manifest_sha256", "binding_sha256",
                "row_count", "columns")},
            "files": items,
        }
        self._stop(event)
        _publish_bytes(directory / "downloads.json", _json(index))
        return self._completed(job_id, recipe)

    def _completed(self, job_id, recipe):
        directory = self._directory(job_id)
        manifest = self._manifest(job_id, recipe)
        raw = read(directory / "downloads.json", _INDEX_LIMIT)
        index = parse(raw)
        _need(isinstance(index, dict) and index.get("schema") == INDEX_SCHEMA
              and index.get("workspace_id") == self.workspace.identity
              and index.get("job_id") == job_id
              and index.get("recipe_id") == recipe["id"]
              and index.get("recipe_sha256") == recipe["recipe_sha256"]
              and isinstance(index.get("files"), list), "DOWNLOAD_INDEX_CHANGED")
        _need(len(index["files"]) == len(_FILES)
              and {v.get("name") for v in index["files"]} == set(_FILES),
              "DOWNLOAD_INDEX_CHANGED")
        for key in ("workspace_id", "query_export_id", "manifest_sha256",
                    "binding_sha256", "row_count", "columns"):
            _need(index["source"].get(key) == manifest["source"].get(key), "SOURCE_CHANGED")
        for item in index["files"]:
            relative, mime, visibility = _FILES[item["name"]]
            _need(item.get("relative") == relative and item.get("mime") == mime
                  and item.get("visibility") == visibility
                  and type(item.get("bytes")) is int and item["bytes"] >= 0,
                  "DOWNLOAD_INDEX_CHANGED")
            _sha(item.get("sha256"))
            with _verified_file(directory / relative, item):
                pass
        return {**index, "index_sha256": digest(raw),
                "package_manifest_sha256": digest(read(directory / "manifest.json", _MANIFEST_LIMIT)),
                "package": manifest["package"], "recipe_name": recipe["name"],
                "recipe_revision": recipe["revision"]}

    def run(self, job_id, spec):
        job_id = _id(job_id)
        with self._operation(job_id) as event:
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                recipe = self.validate(db, spec)
                self._observe(db, job_id, "PREPARATION_STARTED",
                              {"recipe_id": recipe["id"], "recipe_sha256": recipe["recipe_sha256"]})
                db.commit()
            # Complete output takes precedence over a late cancellation or lost
            # final response, and does not require the original SQL to run again.
            try:
                return self._completed(job_id, recipe)
            except (BuyerError, OSError, ValueError, TypeError, KeyError):
                pass
            self._stop(event)
            reader, source, _ = self._source(recipe["source"]["query_export_id"],
                                              recipe["source"]["manifest_sha256"])
            _need(source == recipe["source"], "SOURCE_CHANGED")
            try:
                manifest = build_package(reader, self._directory(job_id), recipe["recipe"],
                                         cancelled=event.is_set)
                self._stop(event)
                result = self._finish_files(job_id, recipe, manifest, event)
            except BaseException as issue:
                try:
                    return self._completed(job_id, recipe)
                except (BuyerError, OSError, ValueError, TypeError, KeyError):
                    pass
                detail = getattr(issue, "details", None)
                failure = {"error": issue.code if isinstance(issue, BuyerError) else type(issue).__name__}
                if isinstance(detail, dict):
                    # The original serializer identifies the selected field and
                    # row without copying private cell contents into an error.
                    failure["details"] = {k: detail[k] for k in
                                          ("row", "column", "output", "representation") if k in detail}
                try:
                    with self.database._connection() as db:
                        self._observe(db, job_id, "PREPARATION_FAILED", failure)
                except Exception as observation_error:
                    raise issue from observation_error
                raise
            with self.database._connection() as db:
                self._observe(db, job_id, "PACKAGE_PREPARED",
                              {"index_sha256": result["index_sha256"],
                               "package_manifest_sha256": result["package_manifest_sha256"]})
            return result

    def recover_completed(self):
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT id,request FROM sf_analysis_jobs WHERE kind='dataset-package' "
                              "AND status IN ('INTERRUPTED','FAILED','CANCELLED')").fetchall()
        for row in rows:
            if not (self._directory(row["id"]) / "downloads.json").is_file():
                continue
            try:
                spec = parse(row["request"].encode("utf-8"))
                with self.database._connection(readonly=True) as db:
                    recipe = self.validate(db, spec)
                result = self._completed(row["id"], recipe)
            except (BuyerError, OSError, ValueError, TypeError, KeyError):
                continue
            with self.database._connection() as db:
                db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',finished_at=?,result=?,error=NULL "
                           "WHERE id=? AND kind='dataset-package' AND status IN ('INTERRUPTED','FAILED','CANCELLED')",
                           (_now(), _json(result).decode("utf-8"), row["id"]))

    def history(self, *, before=None, limit=25):
        _page(before, limit)
        with self._operation():
            with self.database._connection(readonly=True) as db:
                rows = db.execute("SELECT sequence,id,status,created_at,finished_at,request,result,error "
                                  "FROM sf_analysis_jobs WHERE kind='dataset-package' "
                                  "AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                                  (before, before, limit + 1)).fetchall()
            items = []
            for row in rows[:limit]:
                item = dict(row)
                item["request"] = parse(item["request"].encode("utf-8"))
                item["result"] = parse(item["result"].encode("utf-8")) if item["result"] else None
                item["progress"] = self.progress(item["id"])
                items.append(item)
            return {"items": items, "next_before": items[-1]["sequence"]
                    if len(rows) > limit else None}

    def downloads(self, job_id):
        with self._operation():
            job = self.workspace._job(_id(job_id))
            _need(job["kind"] == "dataset-package" and job["status"] == "COMPLETE"
                  and isinstance(job.get("result"), dict), "COMPLETE_PACKAGE_REQUIRED")
            with self.database._connection(readonly=True) as db:
                recipe = self.validate(db, job["request"])
            result = self._completed(job_id, recipe)
            _need(result == job["result"], "RETAINED_RESULT_CHANGED")
            return result

    @contextmanager
    def download(self, job_id, name, *, expected_sha256=None):
        _need(name in _FILES or name == "downloads.json", "FILE_INVALID")
        with self._operation() as event:
            index = self.downloads(job_id)
            if name == "downloads.json":
                raw = read(self._directory(job_id) / name, _INDEX_LIMIT)
                _need(digest(raw) == index["index_sha256"], "DOWNLOAD_INDEX_CHANGED")
                item = {"name": name, "relative": name, "bytes": len(raw),
                        "sha256": index["index_sha256"], "mime": "application/json",
                        "visibility": "private"}
            else:
                item = next(v for v in index["files"] if v["name"] == name)
            if expected_sha256 is not None:
                _need(item["sha256"] == _sha(expected_sha256), "FILE_CHANGED")
            self._stop(event)
            with _verified_file(self._directory(job_id) / item["relative"], item,
                                event.is_set) as stream:
                yield stream, {k: item[k] for k in ("name", "bytes", "sha256", "mime", "visibility")}

    def archive_files(self, job_id):
        """Expose exact original output members to the existing workspace archive."""
        index = self.downloads(job_id)
        directory = self._directory(job_id)
        records = [{"path": str(directory / v["relative"]),
                    "relative": (directory / v["relative"]).relative_to(self.database.directory).as_posix(),
                    "bytes": v["bytes"], "sha256": v["sha256"]}
                   for v in index["files"]]
        raw = read(directory / "downloads.json", _INDEX_LIMIT)
        records.append({"path": str(directory / "downloads.json"),
                        "relative": (directory / "downloads.json").relative_to(self.database.directory).as_posix(),
                        "bytes": len(raw), "sha256": digest(raw)})
        return records
