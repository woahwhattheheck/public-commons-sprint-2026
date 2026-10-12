"""Immutable portfolio artifacts and resumable local operations."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import threading
from datetime import datetime, timezone
import uuid
import zipfile

SHA = re.compile(r"[0-9a-f]{64}\Z")
REQUEST = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
TABLES = frozenset({"editions", "reviews", "comparisons", "exports"})
BLOCK = 1024 * 1024


class PortfolioError(ValueError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self):
        return {"code": self.code, "message": str(self), "details": self.details}


def require(condition, code, message, details=None):
    if not condition:
        raise PortfolioError(code, message, details)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def checked_id(value):
    require(isinstance(value, str) and SHA.fullmatch(value),
            "invalid_id", "Select a complete original SHA-256.")
    return value


def checked_request(value):
    require(isinstance(value, str) and REQUEST.fullmatch(value),
            "invalid_request", "Use a stable request identifier with letters, numbers, dots, dashes or underscores.")
    return value


def safe_directory(path):
    path = Path(path).absolute()
    if path.exists():
        require(not path.is_symlink() and path.is_dir(),
                "directory_changed", "The selected workspace directory is not a regular directory.", str(path))
    else:
        path.mkdir(parents=True, mode=0o700)
    return path


def open_regular(path):
    path = Path(path)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode) and not path.is_symlink(),
                "not_regular", "Select a regular original file.", str(path))
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def sync_directory(path):
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def file_identity(path):
    h, size = hashlib.sha256(), 0
    with open_regular(path) as stream:
        while chunk := stream.read(BLOCK):
            h.update(chunk)
            size += len(chunk)
    return {"sha256": h.hexdigest(), "bytes": size}


def read_json(path):
    with open_regular(path) as stream:
        return json.load(stream)


def atomic_json(path, value, *, immutable=False):
    path = Path(path)
    raw = canonical(value)
    safe_directory(path.parent)
    temporary = path.parent / (".pending-" + uuid.uuid4().hex)
    try:
        with open(temporary, "xb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(path.read_bytes() == raw, "original_record_changed",
                        "This original record already contains different data.", str(path))
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


_LOCAL_LOCKS = {}
_LOCAL_GUARD = threading.Lock()


@contextlib.contextmanager
def file_lock(path):
    path = Path(path)
    safe_directory(path.parent)
    with _LOCAL_GUARD:
        lock = _LOCAL_LOCKS.setdefault(str(path.absolute()), threading.RLock())
    with lock:
        with open(path, "a+b") as stream:
            if os.name == "nt":
                import msvcrt
                stream.seek(0, os.SEEK_END)
                if not stream.tell():
                    stream.write(b"0")
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "nt":
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Operation:
    def __init__(self, path, request_id, kind, payload):
        self.path = safe_directory(path)
        self.request_id = checked_request(request_id)
        self.intent = {"schema": "project-portfolio-operation.v1", "request_id": request_id,
                       "kind": kind, "payload": payload}
        atomic_json(self.path / "request.json", self.intent, immutable=True)

    def result(self):
        path = self.path / "result.json"
        return read_json(path) if path.exists() else None

    def phase(self, name):
        checked_request(name)
        path = self.path / (name + ".json")
        return read_json(path) if path.exists() else None

    def checkpoint(self, name, value):
        checked_request(name)
        atomic_json(self.path / (name + ".json"), value, immutable=True)
        return value

    def complete(self, result):
        self.checkpoint("result", result)
        return result

    def failure(self, error):
        value = {"at": now(), "type": type(error).__name__,
                 **(error.as_dict() if isinstance(error, PortfolioError)
                    else {"message": str(error)})}
        with open(self.path / "errors.jsonl", "ab") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())


class Store:
    def __init__(self, root):
        self.root = safe_directory(root)
        self.directory = safe_directory(self.root / "portfolio")
        for name in ("objects", "operations"):
            safe_directory(self.directory / name)
        self.database = self.directory / "catalogue.sqlite3"
        require(not self.database.is_symlink(), "database_changed", "The portfolio catalogue cannot be a symbolic link.")
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            require(version in (0, 1), "catalogue_version", "Open this catalogue with its installed application version.")
            if version == 0:
                for table in TABLES:
                    db.execute("CREATE TABLE IF NOT EXISTS " + table +
                               " (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL)")
                db.execute("PRAGMA user_version=1")
            else:
                existing = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                require(TABLES <= existing, "catalogue_tables", "The original portfolio catalogue is missing a record family.")

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30)
        try:
            db.execute("PRAGMA busy_timeout=30000")
            db.execute("PRAGMA foreign_keys=ON")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def object_path(self, sha256, *, verify=True):
        sha256 = checked_id(sha256)
        path = self.directory / "objects" / sha256[:2] / sha256
        if verify:
            require(file_identity(path)["sha256"] == sha256,
                    "object_changed", "The retained original artifact changed.", sha256)
        return path

    def put_bytes(self, raw):
        require(isinstance(raw, bytes), "invalid_bytes", "Retain complete original bytes.")
        sha = hashlib.sha256(raw).hexdigest()
        path = self.object_path(sha, verify=False)
        safe_directory(path.parent)
        if path.exists():
            require(file_identity(path) == {"sha256": sha, "bytes": len(raw)},
                    "object_changed", "The retained artifact has changed.", sha)
        else:
            temporary = path.parent / (".pending-" + uuid.uuid4().hex)
            try:
                with open(temporary, "xb") as stream:
                    os.chmod(temporary, 0o600)
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    require(file_identity(path) == {"sha256": sha, "bytes": len(raw)},
                            "object_changed", "A concurrent artifact has different bytes.", sha)
                sync_directory(path.parent)
            finally:
                temporary.unlink(missing_ok=True)
        return {"sha256": sha, "bytes": len(raw)}

    def put_file(self, source):
        source = Path(source)
        stage = self.directory / "objects" / (".pending-" + uuid.uuid4().hex)
        h, size = hashlib.sha256(), 0
        try:
            with open_regular(source) as original, open(stage, "xb") as target:
                os.chmod(stage, 0o600)
                before = os.fstat(original.fileno())
                while raw := original.read(BLOCK):
                    target.write(raw)
                    h.update(raw)
                    size += len(raw)
                after = os.fstat(original.fileno())
                require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                        "source_changed", "The selected original file changed during intake.", str(source))
                target.flush()
                os.fsync(target.fileno())
            sha = h.hexdigest()
            path = self.object_path(sha, verify=False)
            safe_directory(path.parent)
            try:
                os.link(stage, path)
            except FileExistsError:
                require(file_identity(path) == {"sha256": sha, "bytes": size},
                        "object_changed", "The retained artifact has changed.", sha)
            sync_directory(path.parent)
            return {"sha256": sha, "bytes": size}
        finally:
            stage.unlink(missing_ok=True)

    def put_json(self, value):
        return self.put_bytes(canonical(value))

    def object_json(self, sha256):
        return read_json(self.object_path(sha256))

    def put_record(self, table, value):
        require(table in TABLES, "record_table", "Choose an existing portfolio record family.")
        record_id = checked_id(value["id"])
        raw = canonical(value).decode("utf-8")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT record FROM " + table + " WHERE id=?", (record_id,)).fetchone()
            if existing:
                require(existing[0] == raw, "record_changed", "The original content-addressed record changed.", record_id)
            else:
                db.execute("INSERT INTO " + table + " VALUES (?,?,?)",
                           (record_id, value["created_at"], raw))
        return value

    def record(self, table, record_id):
        require(table in TABLES, "record_table", "Choose an existing portfolio record family.")
        with self.connect() as db:
            row = db.execute("SELECT record FROM " + table + " WHERE id=?", (checked_id(record_id),)).fetchone()
        require(row is not None, "record_missing", "The selected portfolio record is absent.", record_id)
        return json.loads(row[0])

    def records(self, table, cursor="", limit=25):
        require(table in TABLES and isinstance(cursor, str) and type(limit) is int and 1 <= limit <= 250,
                "invalid_page", "Choose an existing family and page size between 1 and 250.")
        if cursor:
            checked_id(cursor)
        with self.connect() as db:
            rows = db.execute("SELECT id,record FROM " + table + " WHERE id>? ORDER BY id LIMIT ?",
                              (cursor, limit + 1)).fetchall()
            count = db.execute("SELECT count(*) FROM " + table).fetchone()[0]
        return {"items": [json.loads(row[1]) for row in rows[:limit]], "total": count,
                "next_cursor": rows[limit-1][0] if len(rows) > limit else None}

    @contextlib.contextmanager
    def operation(self, request_id, kind, payload):
        request_id = checked_request(request_id)
        path = self.directory / "operations" / request_id
        with file_lock(self.directory / "workspace.lock"):
            with file_lock(path / "operation.lock"):
                operation = Operation(path, request_id, kind, payload)
                try:
                    yield operation
                except BaseException as error:
                    try:
                        operation.failure(error)
                    except OSError:
                        pass
                    raise

    def operation_status(self, request_id):
        path = self.directory / "operations" / checked_request(request_id)
        request = read_json(path / "request.json")
        result_path = path / "result.json"
        errors = []
        error_path = path / "errors.jsonl"
        if error_path.exists():
            with open_regular(error_path) as stream:
                errors = [json.loads(line) for line in stream if line.strip()]
        return {"request": request, "result": read_json(result_path) if result_path.exists() else None,
                "state": "complete" if result_path.exists() else "retained",
                "errors": errors}

    def export_workspace(self, destination):
        destination = Path(destination).absolute()
        require(not destination.is_relative_to(self.root),
                "archive_destination", "Save the project archive outside its working directory.")
        safe_directory(destination.parent)
        with file_lock(self.directory / "workspace.lock"):
            with tempfile.TemporaryDirectory(prefix="portfolio-export-", dir=destination.parent) as temporary:
                temporary = Path(temporary)
                snapshot = temporary / "catalogue.sqlite3"
                with self.connect() as source:
                    target = sqlite3.connect(snapshot)
                    try:
                        source.backup(target)
                        target.commit()
                    finally:
                        target.close()
                files = []
                for path in sorted(self.root.rglob("*")):
                    relative = path.relative_to(self.root).as_posix()
                    require(not path.is_symlink(), "archive_symlink",
                            "Resolve the selected project file before exporting a portable workspace.", relative)
                    owned_lock = (relative in ("receiving.lock", "portfolio/workspace.lock", "operator/workspace.lock")
                                  or relative.startswith("portfolio/operations/") and path.name == "operation.lock"
                                  or relative.startswith("operator/controls/") and path.name.endswith(".lock"))
                    sqlite_aux = relative in {"portfolio/catalogue.sqlite3" + suffix for suffix in ("-wal", "-shm", "-journal")}
                    if not path.is_file() or owned_lock or sqlite_aux or path.name.startswith(".pending-"):
                        continue
                    if relative in ("PORTFOLIO-WORKSPACE.json", "PORTFOLIO-RECEIVING.json"):
                        continue
                    actual = snapshot if path == self.database else path
                    files.append({"path": relative, **file_identity(actual), "_actual": actual})
                public = [{k: v for k, v in item.items() if k != "_actual"} for item in files]
                manifest = {"schema": "project-portfolio-workspace.v1", "files": public,
                            "created_at": now(), "file_count": len(public),
                            "bytes": sum(row["bytes"] for row in public)}
                archive = temporary / "workspace.zip"
                with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as output:
                    output.writestr("PORTFOLIO-WORKSPACE.json", canonical(manifest))
                    for row in files:
                        output.write(row["_actual"], row["path"])
                        require(file_identity(row["_actual"]) == {"sha256": row["sha256"], "bytes": row["bytes"]},
                                "archive_source_changed", "A selected project artifact changed during export.", row["path"])
                with open_regular(archive) as stream:
                    os.fsync(stream.fileno())
                require(not destination.exists(), "archive_exists", "Choose a new archive filename to retain its previous edition.")
                os.link(archive, destination)
                sync_directory(destination.parent)
                return {"path": str(destination), **file_identity(destination), "manifest": manifest}

    @classmethod
    def receive_workspace(cls, archive_path, destination):
        archive_path = Path(archive_path).absolute()
        archive_identity = file_identity(archive_path)
        destination = Path(destination).absolute()
        safe_directory(destination)
        receipt_path = destination / "PORTFOLIO-RECEIVING.json"
        lock_path = destination / "receiving.lock"
        with file_lock(lock_path):
            if receipt_path.exists():
                old = read_json(receipt_path)
                require(old["archive"] == archive_identity, "different_receiving",
                        "This destination belongs to a different original project archive.")
                if old.get("state") == "complete":
                    # This is now an editable working project. Replaying the
                    # completed receive must not overwrite its later changes.
                    return old
            else:
                existing = [p.name for p in destination.iterdir() if p.name != lock_path.name]
                require(not existing, "receiving_destination",
                        "Receive into an empty directory or resume the same original receiving.", existing)
                atomic_json(receipt_path, {"schema": "project-portfolio-receiving.v1",
                                          "archive": archive_identity, "state": "receiving"})
            with open_regular(archive_path) as raw, zipfile.ZipFile(raw) as archive:
                names = archive.namelist()
                require(len(names) == len(set(names)), "duplicate_archive_member", "The project archive has duplicate members.")
                manifest = json.loads(archive.read("PORTFOLIO-WORKSPACE.json"))
                require(manifest.get("schema") == "project-portfolio-workspace.v1" and isinstance(manifest.get("files"), list),
                        "archive_manifest", "Choose a complete original portfolio workspace archive.")
                folded, expected = set(), {"PORTFOLIO-WORKSPACE.json"}
                for row in manifest["files"]:
                    name = row["path"]
                    path = PurePosixPath(name)
                    require(isinstance(name, str) and "\\" not in name and not path.is_absolute()
                            and all(part not in ("", ".", "..") and ":" not in part and "\x00" not in part for part in path.parts)
                            and path.as_posix() == name,
                            "archive_path", "A project archive member is not a portable relative path.", name)
                    require(name.casefold() not in folded and name not in ("PORTFOLIO-WORKSPACE.json", "PORTFOLIO-RECEIVING.json", "receiving.lock"),
                            "archive_collision", "A project archive contains colliding members.", name)
                    folded.add(name.casefold())
                    expected.add(name)
                    checked_id(row["sha256"])
                    require(type(row["bytes"]) is int and row["bytes"] >= 0,
                            "archive_size", "A project archive member has an invalid size.", name)
                    info = archive.getinfo(name)
                    require(not stat.S_ISLNK(info.external_attr >> 16) and info.file_size == row["bytes"],
                            "archive_member", "A project archive member changed type or size.", name)
                require(set(names) == expected and len(manifest["files"]) == manifest["file_count"]
                        and sum(r["bytes"] for r in manifest["files"]) == manifest["bytes"],
                        "archive_members", "The original archive manifest does not describe every member.")
                for row in manifest["files"]:
                    target = destination / row["path"]
                    safe_directory(target.parent)
                    if target.exists():
                        require(file_identity(target) == {"sha256": row["sha256"], "bytes": row["bytes"]},
                                "received_file_changed", "The received project contains an edited member. Keep it in its own working edition.", row["path"])
                        continue
                    stage = target.parent / (".pending-" + uuid.uuid4().hex)
                    h, size = hashlib.sha256(), 0
                    try:
                        with archive.open(row["path"]) as source, open(stage, "xb") as output:
                            os.chmod(stage, 0o600)
                            while chunk := source.read(BLOCK):
                                output.write(chunk)
                                h.update(chunk)
                                size += len(chunk)
                                require(size <= row["bytes"], "archive_size", "A received file exceeds its retained size.", row["path"])
                            output.flush()
                            os.fsync(output.fileno())
                        require({"sha256": h.hexdigest(), "bytes": size} == {"sha256": row["sha256"], "bytes": row["bytes"]},
                                "archive_digest", "A received project file differs from its original bytes.", row["path"])
                        os.link(stage, target)
                        sync_directory(target.parent)
                    finally:
                        stage.unlink(missing_ok=True)
                require(file_identity(archive_path) == archive_identity, "archive_changed",
                        "The original archive changed during receiving.")
                atomic_json(destination / "PORTFOLIO-WORKSPACE.json", manifest, immutable=True)
                database = destination / "portfolio" / "catalogue.sqlite3"
                require(database.is_file() and not database.is_symlink(),
                        "received_catalogue", "The original archive must include its complete portfolio catalogue.")
                db = sqlite3.connect(database)
                try:
                    require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                            and db.execute("PRAGMA user_version").fetchone()[0] == 1,
                            "received_catalogue", "The original portfolio catalogue failed native integrity or version reading.")
                    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    require(TABLES <= tables, "received_catalogue", "The original catalogue is missing a record family.")
                finally:
                    db.close()
                result = {"schema": "project-portfolio-receiving.v1", "archive": archive_identity,
                          "state": "complete", "file_count": manifest["file_count"],
                          "bytes": manifest["bytes"], "destination": str(destination)}
                atomic_json(receipt_path, result)
        store = cls(destination)
        with store.connect() as db:
            require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok",
                    "received_catalogue", "The received native portfolio catalogue could not be reopened.")
        return result
