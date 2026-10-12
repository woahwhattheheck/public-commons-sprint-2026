"""Complete portable Analysis snapshots on the original database and job owner.

The original SQLite backup selects the snapshot. Only immutable outputs named
by its completed jobs are included; producer paths are retained as provenance.
Local file authority always starts at the operator-selected database directory.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import threading
import zipfile

from .analysis_workbooks import _open_private, _file_record
from .errors import StateError
from .storage import digest, dump, parse, private_directory, read, sync_directory, write

ARCHIVE_SCHEMA = "stellar-forge.analysis-workspace-archive.v1"
EXPORT_SCHEMA = "stellar-forge.analysis-workspace-export.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_CHUNK = 1024 * 1024
_MAX_MANIFEST = 64 * 1024 * 1024
_MAX_FILES = 1_000_000
_MANIFEST_NAME = "archive-manifest.json"
_OUTPUTS = {"query-export", "workbook", "report-export", "change-export", "backup", "workspace-export"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode()


def _need(condition, code):
    if not condition:
        raise StateError(code)


def _id(value):
    _need(isinstance(value, str) and _ID.fullmatch(value), "WORKSPACE_ARCHIVE_ID_INVALID")
    return value


def _relative(value):
    _need(isinstance(value, str) and 0 < len(value) <= 2048 and "\\" not in value
          and "\x00" not in value and ":" not in value, "WORKSPACE_ARCHIVE_PATH_INVALID")
    p = PurePosixPath(value)
    _need(not p.is_absolute() and p.as_posix() == value and
          all(part not in {"", ".", ".."} for part in p.parts), "WORKSPACE_ARCHIVE_PATH_INVALID")
    return value


def _allowed_payload(value):
    """The portable format carries data files, never a launcher or executable."""
    _relative(value)
    if value == "datasets.sqlite3":
        return True
    if re.fullmatch(r"analysis-query-exports/(?:[a-f0-9]{32}/(?:manifest\.json|rows\.(?:csv|jsonl|sqlite3))|control/[a-f0-9]{32}\.json)", value):
        return True
    if re.fullmatch(r"analysis-exports/(?:report|changes)-[a-f0-9]{64}\.(?:html|json|zip|csv)", value):
        return True
    if re.fullmatch(r"analysis-backups/[a-f0-9]{32}/datasets\.sqlite3", value):
        return True
    return bool(re.fullmatch(
        r"analysis-workbooks/[a-f0-9]{32}/(?:manifest\.json|handoff\.zip|workbook\.xlsx|definition\.json|"
        r"history/definition-[0-9]+\.json|sources/report-[a-f0-9]{32}/report\.json|"
        r"sources/query-export-[a-f0-9]{32}/(?:manifest\.json|rows\.(?:csv|jsonl|sqlite3)))", value))


def _entry(value):
    _need(isinstance(value, dict) and _allowed_payload(value.get("path")), "WORKSPACE_ARCHIVE_PAYLOAD_INVALID")
    _need(type(value.get("bytes")) is int and value["bytes"] >= 0 and
          isinstance(value.get("sha256"), str) and _HASH.fullmatch(value["sha256"]),
          "WORKSPACE_ARCHIVE_FILE_IDENTITY_INVALID")
    return {key: value[key] for key in ("path", "bytes", "sha256")}


def _payload(root, relative):
    _need(_allowed_payload(relative), "WORKSPACE_ARCHIVE_PAYLOAD_INVALID")
    root = private_directory(Path(root), create=False)
    path = root / relative
    for parent in reversed(path.parents):
        if parent == root or root in parent.parents:
            _need(private_directory(parent, create=False) == parent, "WORKSPACE_ARCHIVE_DIRECTORY_CHANGED")
    return path


def _signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _table_rows(db):
    tables = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    return {row[0]: db.execute('SELECT COUNT(*) FROM "' + row[0].replace('"', '""') + '"').fetchone()[0] for row in tables}


def inspect_archive(path, *, expected_sha256=None):
    """Stream-verify every exact member before a receiving operation publishes."""
    path = Path(path).expanduser().absolute()
    if expected_sha256 is not None:
        _need(isinstance(expected_sha256, str) and _HASH.fullmatch(expected_sha256), "WORKSPACE_ARCHIVE_DIGEST_INVALID")
    with _open_private(path) as source:
        before = os.fstat(source.fileno())
        archive_sha = hashlib.file_digest(source, "sha256").hexdigest()
        _need(expected_sha256 is None or archive_sha == expected_sha256, "WORKSPACE_ARCHIVE_DIGEST_CHANGED")
        source.seek(0)
        try:
            with zipfile.ZipFile(source) as archive:
                infos = archive.infolist()
                _need(2 <= len(infos) <= _MAX_FILES + 1, "WORKSPACE_ARCHIVE_MEMBER_COUNT_INVALID")
                names = [item.filename for item in infos]
                _need(len(set(names)) == len(names), "WORKSPACE_ARCHIVE_DUPLICATE_MEMBER")
                meta = archive.getinfo(_MANIFEST_NAME)
                _need(0 < meta.file_size <= _MAX_MANIFEST, "WORKSPACE_ARCHIVE_MANIFEST_SIZE_INVALID")
                raw = archive.read(meta)
                manifest = parse(raw)
                _need(isinstance(manifest, dict) and manifest.get("schema") == ARCHIVE_SCHEMA,
                      "WORKSPACE_ARCHIVE_FORMAT_INVALID")
                _id(manifest.get("id")); _id(manifest.get("workspace_id"))
                records = manifest.get("files")
                _need(isinstance(records, list) and 1 <= len(records) <= _MAX_FILES, "WORKSPACE_ARCHIVE_FILES_INVALID")
                records = [_entry(item) for item in records]
                paths = [item["path"] for item in records]
                _need(paths == sorted(set(paths)), "WORKSPACE_ARCHIVE_PAYLOAD_ORDER_INVALID")
                database = _entry(manifest.get("database"))
                _need(database["path"] == "datasets.sqlite3" and database in records,
                      "WORKSPACE_ARCHIVE_DATABASE_REQUIRED")
                _need(set(names) == {_MANIFEST_NAME, *("workspace/" + item for item in paths)},
                      "WORKSPACE_ARCHIVE_MEMBER_SET_CHANGED")
                expected = {"workspace/" + item["path"]: item for item in records}
                for info in infos:
                    mode = info.external_attr >> 16
                    _need(not info.is_dir() and not info.flag_bits & 1 and
                          stat.S_IFMT(mode) in {0, stat.S_IFREG}, "WORKSPACE_ARCHIVE_MEMBER_TYPE_INVALID")
                    _need(info.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED},
                          "WORKSPACE_ARCHIVE_COMPRESSION_UNSUPPORTED")
                    if info.filename == _MANIFEST_NAME:
                        continue
                    record = expected[info.filename]
                    _need(info.file_size == record["bytes"], "WORKSPACE_ARCHIVE_FILE_SIZE_CHANGED")
                    count, sha = 0, hashlib.sha256()
                    with archive.open(info) as stream:
                        while block := stream.read(_CHUNK):
                            count += len(block)
                            _need(count <= record["bytes"], "WORKSPACE_ARCHIVE_FILE_SIZE_CHANGED")
                            sha.update(block)
                    _need(count == record["bytes"] and sha.hexdigest() == record["sha256"],
                          "WORKSPACE_ARCHIVE_PAYLOAD_CHANGED")
        except (KeyError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, EOFError):
            raise StateError("WORKSPACE_ARCHIVE_ZIP_INVALID") from None
        _need(_signature(before) == _signature(os.fstat(source.fileno())), "WORKSPACE_ARCHIVE_CHANGED_DURING_READ")
    return {"schema": "stellar-forge.analysis-workspace-archive-review.v1",
            "archive": {"path": str(path), "bytes": before.st_size, "sha256": archive_sha},
            "manifest": manifest, "manifest_sha256": digest(raw)}


class WorkspaceArchives:
    """One original job, one retained SQLite snapshot, one complete archive."""

    def __init__(self, database, *, identity, read_job):
        self.database, self.identity, self.read_job = database, identity, read_job
        self.root = database.directory / "analysis-workspace-archives"
        self._closing = threading.Event()
        self._verified = {}
        self._verification_mutex = threading.Lock()

    def prepare(self, request):
        include = request.get("include_previous_backups", False)
        _need(type(include) is bool, "WORKSPACE_ARCHIVE_BACKUP_SELECTION_INVALID")
        return {"include_previous_backups": include}

    def prepare_intent(self, identifier, spec):
        """Persist the original operation before the RUNNING job is committed."""
        folder = self._folder(identifier, create=True)
        # The intent's leaf fsync must also have durable parent entries before
        # the database commits a job that can only resume from this directory.
        sync_directory(folder.parent)
        sync_directory(self.database.directory)
        operation_path = folder / "operation.json"
        operation = {"schema": EXPORT_SCHEMA, "id": identifier, "workspace_id": self.identity, "request": spec}
        if operation_path.exists():
            _need(parse(read(operation_path, _MAX_MANIFEST)) == operation, "WORKSPACE_ARCHIVE_REQUEST_CHANGED")
        else:
            # The workspace lock and single job owner serialize this directory.
            # Rename avoids an unfinished hardlink after process death.
            dump(operation_path, operation)
        return folder

    def _folder(self, identifier, *, create=False):
        _id(identifier)
        root = private_directory(self.root, create=create)
        return private_directory(root / identifier, create=create)

    def _progress(self, identifier, **values):
        path = self._folder(identifier, create=True) / "progress.json"
        dump(path, {"schema": "stellar-forge.analysis-workspace-export-progress.v1", "id": identifier,
                    "updated_at": _now(), **values})

    def progress(self, identifier):
        _id(identifier)
        try:
            return parse(read(self._folder(identifier) / "progress.json", _MAX_MANIFEST))
        except StateError:
            return None

    def cancel(self, identifier):
        job = self.read_job(_id(identifier))
        _need(job["kind"] == "workspace-export", "WORKSPACE_ARCHIVE_JOB_REQUIRED")
        if job["status"] == "RUNNING":
            dump(self._folder(identifier, create=True) / "cancel.json", {"id": identifier, "requested_at": _now()})
        return {"id": identifier, "status": job["status"], "cancel_requested": job["status"] == "RUNNING"}

    def resume(self, identifier):
        folder = self._folder(identifier)
        _need((folder / "operation.json").is_file(), "WORKSPACE_ARCHIVE_ORIGINAL_OPERATION_REQUIRED")
        (folder / "cancel.json").unlink(missing_ok=True)
        sync_directory(folder)

    def close(self):
        self._closing.set()

    def local_output(self, relative):
        """Resolve retained data at this selected workspace after receiving."""
        return _payload(self.database.directory, relative)

    def availability(self, identifier, status):
        """Describe local archive files without rewriting historical job rows."""
        try:
            folder = self._folder(identifier)
            operation = parse(read(folder / "operation.json", _MAX_MANIFEST))
            retained = (operation.get("schema") == EXPORT_SCHEMA and
                        operation.get("id") == identifier and operation.get("workspace_id") == self.identity)
            complete = retained and (folder / "workspace.zip").is_file() and (folder / _MANIFEST_NAME).is_file()
        except (StateError, OSError, AttributeError):
            retained, complete = False, False
        return {"retained": retained,
                "can_resume": retained and status in {"INTERRUPTED", "FAILED", "CANCELLED"},
                "can_download": complete and status == "COMPLETE",
                "reason": None if retained else "This archive remains separate from the restored workspace. Create a new complete backup to export the current saved data."}

    def _cancelled(self, folder):
        if self._closing.is_set() or (folder / "cancel.json").exists():
            raise StateError("WORKSPACE_ARCHIVE_CANCELLED")

    def _selection(self, db, *, include_previous_backups=False, review_missing=None):
        """Resolve only current local paths for immutable completed output IDs."""
        selected, outputs, exclusions = {}, [], []

        def add(path, record, owner):
            item = _entry({"path": path, "bytes": record.get("bytes"), "sha256": record.get("sha256")})
            if path in selected:
                _need(selected[path] == item, "WORKSPACE_ARCHIVE_OUTPUT_IDENTITY_CONFLICT")
            selected[path] = item

        for row in db.execute("SELECT id,kind,status,result FROM sf_analysis_jobs ORDER BY sequence"):
            identifier, kind, status, raw = row
            if kind not in _OUTPUTS or status != "COMPLETE":
                continue
            _id(identifier)
            result = parse(raw.encode()) if raw else {}
            if kind == "workspace-export" or kind == "backup" and not include_previous_backups:
                exclusions.append({"id": identifier, "kind": kind,
                                   "reason": "Earlier portable archives remain separate" if kind == "workspace-export" else "Earlier database backups not selected"})
                continue
            outputs.append({"id": identifier, "kind": kind,
                            "producer_directory": result.get("directory") or str(Path(result.get("path", "")).parent)})
            if kind == "query-export":
                _need(result.get("schema") == "stellar-forge.analysis-query-export.v1", "WORKSPACE_ARCHIVE_QUERY_EXPORT_INVALID")
                for item in result.get("files", []):
                    add("analysis-query-exports/" + identifier + "/" + item["name"], item, identifier)
                names = {item.get("name") for item in result.get("files", [])}
                _need(2 <= len(names) <= 4 and "manifest.json" in names and
                      names <= {"rows.csv", "rows.jsonl", "rows.sqlite3", "manifest.json"},
                      "WORKSPACE_ARCHIVE_COMPLETE_QUERY_EXPORT_REQUIRED")
                control = "analysis-query-exports/control/" + identifier + ".json"
                try:
                    if (self.database.directory / control).exists():
                        path = _payload(self.database.directory, control)
                        add(control, _file_record(path), identifier)
                except (StateError, OSError):
                    if review_missing is None:
                        raise StateError("WORKSPACE_ARCHIVE_QUERY_CONTROL_CHANGED") from None
                    review_missing.append({"path": control, "id": identifier,
                                           "reason": "query_control_changed"})
            elif kind == "workbook":
                _need(result.get("schema") == "stellar-forge.customer-workbook.v1" and result.get("id") == identifier,
                      "WORKSPACE_ARCHIVE_WORKBOOK_INVALID")
                base = "analysis-workbooks/" + identifier + "/"
                # These identities remain known in the original database even
                # when an older database-only backup lacks the source manifest.
                for item in result["files"]:
                    add(base + item["name"], item, identifier)
                try:
                    manifest_path = _payload(self.database.directory, base + "manifest.json")
                    raw_manifest = read(manifest_path, _MAX_MANIFEST)
                    _need(digest(raw_manifest) == result.get("manifest_sha256"), "WORKSPACE_ARCHIVE_WORKBOOK_MANIFEST_CHANGED")
                    manifest = parse(raw_manifest)
                    _need(isinstance(manifest, dict) and manifest.get("complete") is True and
                          manifest.get("id") == identifier and manifest.get("workspace_id") == self.identity and
                          manifest.get("definition_sha256") == result.get("definition_sha256"),
                          "WORKSPACE_ARCHIVE_WORKBOOK_BINDING_CHANGED")
                    _need(isinstance(manifest.get("files"), dict) and
                          all(isinstance(item, dict) for item in manifest["files"].values()),
                          "WORKSPACE_ARCHIVE_WORKBOOK_MANIFEST_CHANGED")
                    records = [_entry({"path": base + name, "bytes": item.get("bytes"),
                                       "sha256": item.get("sha256")}) for name, item in manifest["files"].items()]
                    for item in records:
                        add(item["path"], item, identifier)
                except (StateError, OSError):
                    if review_missing is None:
                        raise
                    review_missing.append({"path": base + "manifest.json", "id": identifier,
                                           "reason": "workbook_manifest_required_or_changed"})
            elif kind in {"report-export", "change-export"}:
                add("analysis-exports/" + result["filename"], result, identifier)
            elif kind == "backup":
                add("analysis-backups/" + identifier + "/datasets.sqlite3", result, identifier)
        return sorted(selected.values(), key=lambda item: item["path"]), outputs, exclusions

    def review(self, *, include_previous_backups=False):
        _need(type(include_previous_backups) is bool, "WORKSPACE_ARCHIVE_BACKUP_SELECTION_INVALID")
        missing = []
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            files, outputs, exclusions = self._selection(db, include_previous_backups=include_previous_backups,
                                                         review_missing=missing)
        missing_paths = {item["path"] for item in missing}
        for item in files:
            if item["path"] in missing_paths:
                continue
            try:
                path = _payload(self.database.directory, item["path"])
                with _open_private(path) as stream:
                    if os.fstat(stream.fileno()).st_size != item["bytes"]:
                        missing.append({"path": item["path"], "reason": "size_changed"})
            except (StateError, OSError):
                missing.append({"path": item["path"], "reason": "retained_file_required"})
        return {"schema": "stellar-forge.analysis-workspace-export-plan.v1", "workspace_id": self.identity,
                "payload_files": len(files) + 1, "payload_bytes": sum(item["bytes"] for item in files),
                "database_bytes": self.database.path.stat().st_size,
                "outputs": outputs, "exclusions": exclusions, "missing": missing,
                "ready": not missing, "include_previous_backups": include_previous_backups}

    def _completed(self, identifier):
        folder = self._folder(identifier)
        record = parse(read(folder / "result.json", _MAX_MANIFEST))
        _need(record.get("schema") == EXPORT_SCHEMA and record.get("id") == identifier and
              record.get("workspace_id") == self.identity, "WORKSPACE_ARCHIVE_RESULT_CHANGED")
        _need({item.get("name") for item in record.get("files", [])} == {"workspace.zip", _MANIFEST_NAME},
              "WORKSPACE_ARCHIVE_RESULT_FILES_CHANGED")
        for item in record["files"]:
            _need(_file_record(folder / item["name"]) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                  "WORKSPACE_ARCHIVE_RESULT_FILE_CHANGED")
        return record

    def run(self, identifier, spec):
        folder = self.prepare_intent(identifier, spec)
        if (folder / "result.json").exists():
            return self._completed(identifier)
        self._cancelled(folder)
        snapshot = private_directory(folder / "snapshot", create=True)
        database_path = snapshot / "datasets.sqlite3"
        # DatasetDatabase.backup publishes its completed copy by hardlink.
        # Release only this operation's same-inode temporary alias if the
        # process died before the original helper's unlink/finally completed.
        if database_path.exists():
            published = database_path.lstat()
            for alias in snapshot.glob(".database-*"):
                candidate = alias.lstat()
                if (stat.S_ISREG(candidate.st_mode) and not candidate.st_mode & 0o077
                        and (candidate.st_dev, candidate.st_ino) == (published.st_dev, published.st_ino)):
                    alias.unlink()
            sync_directory(snapshot)
        if not database_path.exists():
            self._progress(identifier, phase="SNAPSHOT", files_done=0, bytes_done=0)
            self.database.backup(snapshot)
        plan_path = folder / "archive-inputs.json"
        if plan_path.exists():
            manifest = parse(read(plan_path, _MAX_MANIFEST))
        else:
            with sqlite3.connect(database_path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
                db.execute("PRAGMA trusted_schema=OFF")
                _need(db.execute("SELECT workspace_id FROM sf_analysis_format WHERE id=1").fetchone()[0] == self.identity,
                      "WORKSPACE_ARCHIVE_SNAPSHOT_IDENTITY_CHANGED")
                selected, outputs, exclusions = self._selection(db, include_previous_backups=spec["include_previous_backups"])
                rows = _table_rows(db)
            database = {"path": "datasets.sqlite3", **_file_record(database_path)}
            manifest = {"schema": ARCHIVE_SCHEMA, "id": identifier, "workspace_id": self.identity,
                        "created_at": _now(), "source_directory": str(self.database.directory),
                        "database": database, "files": sorted([database, *selected], key=lambda item: item["path"]),
                        "table_rows": rows, "outputs": outputs, "exclusions": exclusions,
                        "runtime_files": "Receiving creates a fresh analysis.lock and launch capability; provider sessions remain operator-owned."}
            dump(plan_path, manifest)
        _need(manifest.get("schema") == ARCHIVE_SCHEMA and manifest.get("id") == identifier and
              manifest.get("workspace_id") == self.identity, "WORKSPACE_ARCHIVE_PLAN_CHANGED")
        files = manifest["files"]
        total = sum(item["bytes"] for item in files)
        self._progress(identifier, phase="ARCHIVING", files_done=0, files_total=len(files), bytes_done=0, bytes_total=total)
        temporary, target = folder / "workspace.zip.part", folder / "workspace.zip"
        # A partial ZIP is rebuilt from the same frozen database and original
        # immutable outputs. No acquisition, query, or new snapshot is repeated.
        temporary.unlink(missing_ok=True)
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        bytes_done = 0
        with os.fdopen(fd, "wb") as output:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for index, record in enumerate(files):
                    self._cancelled(folder)
                    record = _entry(record)
                    path = database_path if record["path"] == "datasets.sqlite3" else _payload(self.database.directory, record["path"])
                    info = zipfile.ZipInfo("workspace/" + record["path"], date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    count, sha = 0, hashlib.sha256()
                    with _open_private(path) as source, archive.open(info, "w", force_zip64=True) as dest:
                        before = os.fstat(source.fileno())
                        while block := source.read(_CHUNK):
                            self._cancelled(folder)
                            count += len(block); sha.update(block); dest.write(block)
                        _need(_signature(before) == _signature(os.fstat(source.fileno())) and
                              count == record["bytes"] and sha.hexdigest() == record["sha256"],
                              "WORKSPACE_ARCHIVE_SOURCE_CHANGED")
                    bytes_done += count
                    self._progress(identifier, phase="ARCHIVING", files_done=index + 1, files_total=len(files),
                                   bytes_done=bytes_done, bytes_total=total)
                meta = zipfile.ZipInfo(_MANIFEST_NAME, date_time=(1980, 1, 1, 0, 0, 0))
                meta.compress_type = zipfile.ZIP_DEFLATED
                meta.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(meta, _json(manifest))
            output.flush(); os.fsync(output.fileno())
        if target.exists():
            _need(_file_record(target) == _file_record(temporary), "WORKSPACE_ARCHIVE_PUBLICATION_CHANGED")
            temporary.unlink()
        else:
            os.link(temporary, target); temporary.unlink()
        sync_directory(folder)
        write(folder / _MANIFEST_NAME, _json(manifest))
        result = {"schema": EXPORT_SCHEMA, "id": identifier, "workspace_id": self.identity,
                  "directory": str(folder), "created_at": manifest["created_at"],
                  "payload_files": len(files), "payload_bytes": total,
                  "files": [{"name": name, **_file_record(folder / name), "mime": mime} for name, mime in
                            [("workspace.zip", "application/zip"), (_MANIFEST_NAME, "application/json")]]}
        dump(folder / "result.json", result)
        self._progress(identifier, phase="COMPLETE", files_done=len(files), files_total=len(files), bytes_done=total, bytes_total=total)
        return result

    def recover_completed(self):
        with self.database._connection(readonly=True) as db:
            identifiers = [row[0] for row in db.execute("SELECT id FROM sf_analysis_jobs WHERE kind='workspace-export' AND status IN ('INTERRUPTED','FAILED')")]
        for identifier in identifiers:
            try:
                result = self._completed(identifier)
            except (StateError, OSError):
                continue
            with self.database._connection() as db:
                db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,error=NULL,finished_at=? WHERE id=? AND status IN ('INTERRUPTED','FAILED')",
                           (_json(result).decode(), _now(), identifier))

    def history(self, *, before=None, limit=25):
        _need(type(limit) is int and 1 <= limit <= 100 and (before is None or type(before) is int and before > 0),
              "WORKSPACE_ARCHIVE_PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute("SELECT sequence,id FROM sf_analysis_jobs WHERE kind='workspace-export' " +
                              ("AND sequence<? " if before is not None else "") + "ORDER BY sequence DESC LIMIT ?",
                              ([before] if before is not None else []) + [limit + 1]).fetchall()
        return {"schema": "stellar-forge.analysis-workspace-export-history.v1",
                "items": [self.read_job(row[1]) for row in rows[:limit]],
                "next_before": rows[limit - 1][0] if len(rows) > limit else None}

    @contextmanager
    def download(self, identifier, name):
        _need(name in {"workspace.zip", _MANIFEST_NAME}, "WORKSPACE_ARCHIVE_DOWNLOAD_INVALID")
        job = self.read_job(_id(identifier))
        _need(job["kind"] == "workspace-export" and job["status"] == "COMPLETE", "WORKSPACE_ARCHIVE_COMPLETE_REQUIRED")
        result = job["result"]
        _need(result.get("schema") == EXPORT_SCHEMA and result.get("id") == identifier and
              result.get("workspace_id") == self.identity, "WORKSPACE_ARCHIVE_RESULT_CHANGED")
        record = next((item for item in result["files"] if item["name"] == name), None)
        _need(record is not None, "WORKSPACE_ARCHIVE_DOWNLOAD_INVALID")
        with _open_private(self._folder(identifier) / name) as stream:
            info = os.fstat(stream.fileno())
            cache_key = (identifier, name)
            signature = (*_signature(info), record["sha256"])
            with self._verification_mutex:
                if self._verified.get(cache_key) != signature:
                    _need(info.st_size == record["bytes"] and
                          hashlib.file_digest(stream, "sha256").hexdigest() == record["sha256"] and
                          _signature(info) == _signature(os.fstat(stream.fileno())),
                          "WORKSPACE_ARCHIVE_DOWNLOAD_CHANGED")
                    self._verified[cache_key] = signature
            stream.seek(0)
            yield stream, record
