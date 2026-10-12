"""Shared exact identities, bounded original files and durable publication."""
from __future__ import annotations

import base64
import contextlib
import datetime as dt
import decimal
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import uuid
import zipfile

MAX_UPLOAD = 64 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_MEMBERS = 5000

class Problem(Exception):
    def __init__(self, code, message, status=409, **detail):
        super().__init__(message)
        self.code, self.message, self.status, self.detail = code, message, status, detail
    def as_dict(self):
        return {"code": self.code, "message": self.message, **self.detail}

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")

def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def json_bytes(value):
    return (json_text(value) + "\n").encode("utf-8")

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json_bytes(value)).hexdigest()

def identifier(value, label="ID"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", value):
        raise Problem("invalid_id", f"{label} must be a nonempty stable identifier.", 400)
    return value

def text(value, label, maximum=4000, required=False):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise Problem("invalid_text", f"{label} must be text of at most {maximum} characters.", 400)
    if required and not value.strip():
        raise Problem("required", f"{label} is required.", 400)
    return value

def integer(value, label, minimum=0, maximum=1000000):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise Problem("invalid_integer", f"{label} must be an integer from {minimum} to {maximum}.", 400)
    return value

def number(value, label, nonnegative=False):
    if not isinstance(value, str) or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value) or len(value) > 100:
        raise Problem("invalid_decimal", f"{label} must be an exact decimal string.", 400)
    parsed = decimal.Decimal(value)
    if not parsed.is_finite() or abs(parsed) > decimal.Decimal("1e100") or (nonnegative and parsed < 0):
        raise Problem("invalid_decimal", f"{label} is outside the supported finite range.", 400)
    return value

def timestamp(value, label="Time"):
    text(value, label, 80, True)
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise Problem("invalid_time", f"{label} must be an ISO date-time with timezone.", 400) from exc
    if parsed.tzinfo is None:
        raise Problem("invalid_time", f"{label} must include a timezone.", 400)
    return value

def relative(value):
    text(value, "Relative path", 2000, True)
    path = PurePosixPath(value)
    if "\\" in value or ":" in value or path.is_absolute() or any(p in ("", ".", "..") for p in value.split("/")):
        raise Problem("unsafe_path", "A package member must have one unambiguous relative path.", 400, path=value)
    return value

def contained(root, name):
    relative(name)
    root = Path(root).resolve()
    path = root.joinpath(*PurePosixPath(name).parts)
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise Problem("symlink", "An original file path may not traverse a symbolic link.", path=name)
    if not path.resolve(strict=False).is_relative_to(root):
        raise Problem("unsafe_path", "File is outside its original workspace.", path=name)
    return path

def file_info(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise Problem("not_regular", "A retained original must be a regular file.", path=str(path))
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            h.update(chunk)
    after = path.stat()
    if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise Problem("file_changed", "The retained file changed while it was read.", path=str(path))
    return {"bytes": info.st_size, "sha256": h.hexdigest()}

def verify_file(path, expected):
    actual = file_info(path)
    if actual["bytes"] != expected["bytes"] or actual["sha256"] != expected["sha256"]:
        raise Problem("file_identity", "Retained file does not match its original size and SHA256.", path=str(path), expected=expected, actual=actual)
    return actual

def sync_directory(path):
    fd = os.open(Path(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def atomic_bytes(path, raw, create_only=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise Problem("symlink", "A durable publication may not replace a symbolic link.")
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if create_only:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != raw:
                    raise Problem("publication_exists", "The original publication already contains different bytes.", path=str(path))
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return file_info(path)

def write_json(path, value, create_only=False):
    return atomic_bytes(path, json_bytes(value), create_only)

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

class Lock:
    def __init__(self, path, blocking=True):
        self.path, self.blocking, self.fd = Path(path), blocking, None
    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | (0 if self.blocking else fcntl.LOCK_NB))
        except BlockingIOError as exc:
            os.close(self.fd)
            self.fd = None
            raise Problem("worker_active", "The original worker or one of its native children still owns this workspace.") from exc
        return self
    def __exit__(self, *_):
        if self.fd is not None:
            # A child inheriting this open description must retain ownership.
            os.close(self.fd)
            self.fd = None

def lock_active(path):
    try:
        with Lock(path, blocking=False):
            return False
    except Problem as exc:
        if exc.code == "worker_active":
            return True
        raise

def decode_upload(encoded):
    if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD * 4 // 3 + 8):
        raise Problem("upload_size", "The original upload exceeds 64 MiB.", 413)
    try:
        value = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise Problem("invalid_base64", "Original upload must be valid base64.", 400) from exc
    if not value or len(value) > MAX_UPLOAD:
        raise Problem("upload_size", "The original upload must contain 1 byte through 64 MiB.", 413)
    return value

def zip_members(raw, maximum=MAX_EXPANDED):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 10000:
                raise Problem("archive_count", "The ZIP contains more than 10,000 entries.", 413)
            files, names, expanded = [], set(), 0
            for item in infos:
                if item.is_dir():
                    relative(item.filename.rstrip("/"))
                    continue
                name = relative(item.filename)
                if name in names:
                    raise Problem("duplicate_member", "ZIP has duplicate original paths.", path=name)
                names.add(name)
                mode = (item.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise Problem("archive_special_file", "ZIP links and special files are not model originals.", path=name)
                if item.flag_bits & 1:
                    raise Problem("archive_encrypted", "Encrypted members must be supplied as their original decrypted files.", path=name)
                expanded += item.file_size
                if len(names) > MAX_MEMBERS or expanded > maximum or item.file_size > MAX_UPLOAD:
                    raise Problem("archive_size", "The expanded original ZIP exceeds the member or byte limit.", 413)
                content = archive.read(item)
                if len(content) != item.file_size:
                    raise Problem("archive_truncated", "Original ZIP member is incomplete.", path=name)
                files.append((name, content))
            if not files:
                raise Problem("empty_package", "The ZIP contains no original files.", 400)
            return files
    except zipfile.BadZipFile as exc:
        raise Problem("invalid_zip", "Original package is not a complete readable ZIP.", 400) from exc

class Objects:
    def __init__(self, root):
        self.root = Path(root)
    def put(self, raw):
        sha = digest(raw)
        path = self.root / sha[:2] / sha
        atomic_bytes(path, raw, create_only=True)
        return {"sha256": sha, "bytes": len(raw)}
    def path(self, record):
        sha = record["sha256"]
        if not re.fullmatch("[0-9a-f]{64}", sha):
            raise Problem("invalid_sha", "Original object hash is invalid.")
        path = self.root / sha[:2] / sha
        verify_file(path, record)
        return path
    def bytes(self, record):
        return self.path(record).read_bytes()

def inventory(root, excluded=()):
    root = Path(root)
    output = []
    for path in sorted(root.rglob("*")):
        name = path.relative_to(root).as_posix()
        if name in excluded or name.endswith(".lock") or any(p.endswith(".tmp") for p in path.parts):
            continue
        if path.is_symlink():
            raise Problem("symlink", "An export contains a symbolic link.", path=name)
        if path.is_file():
            output.append({"path": name, **file_info(path)})
    return output

def verify_inventory(root, rows, exact=False, excluded=()):
    seen = set()
    for row in rows:
        name = relative(row["path"])
        if name in seen:
            raise Problem("duplicate_member", "Manifest contains duplicate files.", path=name)
        seen.add(name)
        verify_file(contained(root, name), row)
    if exact:
        actual = {row["path"] for row in inventory(root, excluded)}
        if actual != seen:
            raise Problem("manifest_members", "Frozen package file set differs from its manifest.", missing=sorted(seen-actual), additional=sorted(actual-seen))
    return {"files": len(rows), "bytes": sum(row["bytes"] for row in rows)}

def zip_directory(root, output, rows):
    output = Path(output)
    if output.exists():
        raise Problem("publication_exists", "The frozen archive already exists; inspect its original receipt.", path=str(output))
    fd, temporary = tempfile.mkstemp(prefix="." + output.name, suffix=".tmp", dir=output.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for row in rows:
                path = contained(root, row["path"])
                verify_file(path, row)
                archive.write(path, row["path"])
                verify_file(path, row)
        os.link(temporary, output)
        sync_directory(output.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return file_info(output)

