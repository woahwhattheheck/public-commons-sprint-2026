"""Private immutable source objects and original operation indexes for the target desk."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid

from .target import TargetError, canonical, digest, utcnow

IDENTITY = re.compile(r"^[0-9a-f]{64}$")
_LOCAL_LOCKS = {}
_LOCAL_GUARD = threading.Lock()


def checked_id(value):
    if not isinstance(value, str) or not IDENTITY.fullmatch(value):
        raise TargetError("OPERATOR_ID", "Select the complete saved 64-character identity.")
    return value


@contextmanager
def file_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = str(path.resolve())
    with _LOCAL_GUARD:
        local = _LOCAL_LOCKS.setdefault(key, threading.RLock())
    with local:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(descriptor).st_size == 0:
                    os.write(descriptor, b"\0")
                os.lseek(descriptor, 0, os.SEEK_SET)
                while True:
                    try:
                        msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        time.sleep(0.05)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            if os.name == "nt":
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)


def sync_directory(path):
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_bytes(path, raw, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise TargetError("OPERATOR_PATH", "A saved object cannot be a symbolic link.")
    if immutable and path.exists():
        if path.read_bytes() != raw:
            raise TargetError("IMMUTABLE_OBJECT_CHANGED", "The retained source object has different bytes.")
        return
    temp = path.parent / ("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temp, path)
            except FileExistsError:
                if path.read_bytes() != raw:
                    raise TargetError("IMMUTABLE_OBJECT_CHANGED", "The retained source object has different bytes.")
            temp.unlink()
        else:
            os.replace(temp, path)
        sync_directory(path.parent)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve() / "operator"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in ("objects", "requests", "deployments", "uploads", "exports", "controls", "cohorts"):
            (self.root / name).mkdir(exist_ok=True, mode=0o700)

    def locked(self):
        return file_lock(self.root / "workspace.lock")

    def put_bytes(self, raw):
        identity = hashlib.sha256(raw).hexdigest()
        write_bytes(self.root / "objects" / identity, raw, immutable=True)
        return {"sha256": identity, "bytes": len(raw)}

    def read_bytes(self, identity):
        checked_id(identity)
        raw = (self.root / "objects" / identity).read_bytes()
        if hashlib.sha256(raw).hexdigest() != identity:
            raise TargetError("OBJECT_HASH", "A retained source object no longer matches its identity.")
        return raw

    def put(self, value):
        return self.put_bytes(canonical(value))

    def read(self, identity):
        return json.loads(self.read_bytes(identity).decode("utf-8"))

    def _index(self, collection, identity):
        if collection not in ("requests", "deployments", "cohorts"):
            raise TargetError("OPERATOR_COLLECTION", "Unknown operator collection.")
        return self.root / collection / (checked_id(identity) + ".json")

    def index(self, collection, identity):
        path = self._index(collection, identity)
        if not path.exists():
            raise TargetError("OPERATOR_NOT_FOUND", "The selected saved item does not exist.")
        raw = path.read_bytes()
        result = json.loads(raw.decode("utf-8"))
        if result.get("id") != identity:
            raise TargetError("INDEX_ID", "The saved index names another item.")
        return result

    def save(self, collection, value, *, expected_revision=None):
        identity = checked_id(value["id"])
        path = self._index(collection, identity)
        previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        revision = previous.get("revision", 0) if previous else 0
        if expected_revision is not None and expected_revision != revision:
            raise TargetError("STALE_REVISION", "This item changed; reopen its current revision.")
        successor = dict(value)
        successor["revision"] = revision + 1
        successor["updated_at"] = utcnow()
        successor["snapshot_sha256"] = digest({k: v for k, v in successor.items() if k != "snapshot_sha256"})
        write_bytes(path, canonical(successor))
        return successor

    def list(self, collection, *, cursor="", limit=25):
        if collection not in ("requests", "deployments", "cohorts") or not 1 <= limit <= 100:
            raise TargetError("OPERATOR_PAGE", "Choose a page size from 1 to 100.")
        rows = []
        for path in (self.root / collection).glob("*.json"):
            value = json.loads(path.read_text(encoding="utf-8"))
            rows.append(value)
        rows.sort(key=lambda row: (row.get("created_at", ""), row["id"]), reverse=True)
        if cursor:
            positions = [i for i, row in enumerate(rows) if row["id"] == cursor]
            if len(positions) != 1:
                raise TargetError("OPERATOR_CURSOR", "Reopen the list; its selected cursor is absent.")
            rows = rows[positions[0] + 1:]
        page = rows[:limit]
        return {"items": page, "next_cursor": page[-1]["id"] if len(rows) > limit else "",
                "complete": len(rows) <= limit}

    def request(self, request_id, kind, arguments):
        checked_id(request_id)
        identity = digest({"kind": kind, "arguments": arguments})
        path = self._index("requests", request_id)
        if path.exists():
            previous = self.index("requests", request_id)
            if previous["input_sha256"] != identity:
                raise TargetError("REQUEST_REUSED", "This original request ID belongs to different input.")
            return previous
        result = {"schema": "portfolio.operator-request.v1", "id": request_id,
                  "kind": kind, "arguments": arguments, "input_sha256": identity,
                  "created_at": utcnow(), "state": "QUEUED"}
        return self.save("requests", result, expected_revision=0)

    def upload(self, raw, filename):
        with self.locked():
            return self._upload(raw, filename)

    def _upload(self, raw, filename):
        if not isinstance(filename, str) or not filename or len(filename) > 240 or any(x in filename for x in ("/", "\\", "\0")):
            raise TargetError("SOURCE_FILENAME", "Use the selected document's base filename.")
        object_ref = self.put_bytes(raw)
        directory = self.root / "uploads" / object_ref["sha256"]
        directory.mkdir(exist_ok=True, mode=0o700)
        path = directory / filename
        write_bytes(path, raw, immutable=True)
        return {"schema": "portfolio.operator-upload.v1", "sha256": object_ref["sha256"],
                "bytes": len(raw), "filename": filename, "path": str(path)}

    def selected_upload(self, value):
        if not isinstance(value, dict):
            raise TargetError("SOURCE_UPLOAD", "Select a retained uploaded source.")
        identity = checked_id(value.get("sha256"))
        name = value.get("filename")
        if not isinstance(name, str) or Path(name).name != name or "/" in name or "\\" in name:
            raise TargetError("SOURCE_FILENAME", "Invalid retained source filename.")
        path = self.root / "uploads" / identity / name
        before = path.stat()
        digestor, count = hashlib.sha256(), 0
        with open(path, "rb") as original:
            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                digestor.update(chunk)
                count += len(chunk)
        after = path.stat()
        if digestor.hexdigest() != identity or ("bytes" in value and count != value["bytes"]) or (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise TargetError("SOURCE_UPLOAD_HASH", "The selected uploaded source changed.")
        return path

    def upload_stream(self, stream, length, filename):
        with self.locked():
            return self._upload_stream(stream, length, filename)

    def _upload_stream(self, stream, length, filename):
        if not isinstance(filename, str) or not filename or len(filename) > 240 or any(x in filename for x in ("/", "\\", "\0")):
            raise TargetError("SOURCE_FILENAME", "Use the selected document's base filename.")
        temp = self.root / "uploads" / ("." + uuid.uuid4().hex + ".incoming")
        digestor, count = hashlib.sha256(), 0
        try:
            with open(temp, "xb") as target:
                os.chmod(temp, 0o600)
                while count < length:
                    chunk = stream.read(min(1024 * 1024, length - count))
                    if not chunk:
                        raise TargetError("SOURCE_INCOMPLETE", "The selected document upload ended early.")
                    target.write(chunk)
                    digestor.update(chunk)
                    count += len(chunk)
                target.flush()
                os.fsync(target.fileno())
            identity = digestor.hexdigest()
            object_path = self.root / "objects" / identity
            try:
                os.link(temp, object_path)
            except FileExistsError:
                actual = hashlib.sha256()
                with open(object_path, "rb") as original:
                    for chunk in iter(lambda: original.read(1024 * 1024), b""):
                        actual.update(chunk)
                if actual.hexdigest() != identity:
                    raise TargetError("SOURCE_OBJECT_CHANGED", "The retained document object changed.")
            sync_directory(object_path.parent)
            directory = self.root / "uploads" / identity
            directory.mkdir(exist_ok=True, mode=0o700)
            path = directory / filename
            try:
                os.link(object_path, path)
            except FileExistsError:
                if path.stat().st_ino != object_path.stat().st_ino or path.stat().st_dev != object_path.stat().st_dev:
                    actual = hashlib.sha256()
                    with open(path, "rb") as original:
                        for chunk in iter(lambda: original.read(1024 * 1024), b""):
                            actual.update(chunk)
                    if actual.hexdigest() != identity:
                        raise TargetError("SOURCE_UPLOAD_CHANGED", "The selected source filename has different bytes.")
            sync_directory(directory)
            return {"schema": "portfolio.operator-upload.v1", "sha256": identity,
                    "bytes": count, "filename": filename, "path": str(path)}
        finally:
            try:
                temp.unlink()
            except FileNotFoundError:
                pass

    def control(self, deployment_id, request_id, *, pause):
        checked_id(deployment_id)
        checked_id(request_id)
        path = self.root / "controls" / (deployment_id + ".json")
        with file_lock(path.with_suffix(".lock")):
            value = {"schema": "portfolio.target-control.v1", "deployment_id": deployment_id,
                     "request_id": request_id, "pause": bool(pause), "at": utcnow()}
            write_bytes(path, canonical(value))
            return value

    def paused(self, deployment_id):
        path = self.root / "controls" / (checked_id(deployment_id) + ".json")
        return bool(json.loads(path.read_text(encoding="utf-8")).get("pause")) if path.exists() else False


    def retain_file(self, source, expected_sha256, expected_bytes):
        source = Path(source)
        before = source.stat()
        hash_value, count = hashlib.sha256(), 0
        with open(source, "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hash_value.update(chunk)
                count += len(chunk)
        after = source.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or (
                count != expected_bytes or hash_value.hexdigest() != expected_sha256):
            raise TargetError("NATIVE_EXPORT_CHANGED", "The original native export changed during receiving.")
        target = self.root / "objects" / checked_id(expected_sha256)
        try:
            os.link(source, target)
        except FileExistsError:
            digestor, retained_bytes = hashlib.sha256(), 0
            with open(target, "rb") as original:
                for chunk in iter(lambda: original.read(1024 * 1024), b""):
                    digestor.update(chunk)
                    retained_bytes += len(chunk)
            if digestor.hexdigest() != expected_sha256 or retained_bytes != expected_bytes:
                raise TargetError("NATIVE_EXPORT_CONFLICT", "The retained original export differs.")
        sync_directory(target.parent)
        return {"sha256": expected_sha256, "bytes": expected_bytes}
