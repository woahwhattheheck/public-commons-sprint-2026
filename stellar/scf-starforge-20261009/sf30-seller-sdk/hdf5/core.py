"""Exact HDF5 source and result custody shared by the workbench."""
from __future__ import annotations
import base64, hashlib, json, os, re, stat, tempfile
from pathlib import Path

SCHEMA = "stellar-forge.hdf5-workspace.v1"
SOURCE = "stellar-forge.hdf5-source.v1"
SELECTION = "stellar-forge.hdf5-selection.v1"
EDITION = "stellar-forge.hdf5-edition.v1"
PACKET = "stellar-forge.hdf5-packet.v1"
HASH = re.compile(r"[0-9a-f]{64}\Z")
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}\Z")
MAX_SOURCE = 256 * 1024 * 1024
MAX_JSON = 16 * 1024 * 1024
MAX_ELEMENTS = 100000
MAX_OUTPUT = 64 * 1024 * 1024

class InputError(Exception):
    def __init__(self, message, code="HDF5_INPUT", status=400):
        super().__init__(message); self.code, self.status = code, status

def encode(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def parse(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result: raise InputError("Duplicate JSON field: " + key)
            result[key] = value
        return result
    def constant(value): raise InputError("Nonfinite JSON number: " + value)
    try: return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, InputError): raise
        raise InputError("Expected complete UTF-8 JSON") from exc

def sha(data): return hashlib.sha256(data).hexdigest()
def fingerprint(value): return sha(encode(value))
def hash_id(value):
    if not isinstance(value, str) or not HASH.fullmatch(value): raise InputError("Expected a complete SHA-256 identity")
    return value
def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value): raise InputError("Use a 1–96 character operation or source ID")
    return value
def only(value, keys):
    if not isinstance(value, dict) or set(value) - set(keys): raise InputError("Unexpected request fields")
    return value
def integer(value, minimum=0, maximum=2**63-1):
    if isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value): value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise InputError("Integer is outside the supported range")
    return value

def directory(path, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        missing=[]; current=path
        while not current.exists():
            missing.append(current); current=current.parent
        for member in reversed(missing):
            try: member.mkdir(mode=0o700)
            except FileExistsError: pass
            sync_dir(member.parent)
    if path.is_symlink() or path.resolve(strict=True) != path: raise InputError("Use a canonical directory without aliases")
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise InputError("Use an operator-owned private directory (0700)")
    if create: sync_dir(path.parent)
    return path

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def read(path, limit=MAX_JSON):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit: raise InputError("Expected a regular file within the byte limit")
        blocks, count = [], 0
        while block := os.read(fd, min(1048576, limit + 1 - count)):
            blocks.append(block); count += len(block)
            if count > limit: raise InputError("File exceeds its byte limit")
        if identity(before) != identity(os.fstat(fd)): raise InputError("Source changed while it was read", "HDF5_SOURCE_CHANGED", 409)
        return b"".join(blocks)
    finally: os.close(fd)

def file_hash(path, limit=MAX_SOURCE):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd); count = 0; digest = hashlib.sha256()
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit: raise InputError("Expected a bounded regular file")
        while block := os.read(fd, 1048576):
            count += len(block)
            if count > limit: raise InputError("File exceeds its byte limit")
            digest.update(block)
        if identity(before) != identity(os.fstat(fd)): raise InputError("File changed during verification", "HDF5_SOURCE_CHANGED", 409)
        return {"bytes": count, "sha256": digest.hexdigest()}
    finally: os.close(fd)

def immutable(path, data):
    """Fully sync a temporary file, then adopt create-only; reuse also syncs its parent."""
    path = Path(path)
    fd, tmp = tempfile.mkstemp(prefix=".incoming-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try: os.link(tmp, path, follow_symlinks=False)
        except FileExistsError:
            if read(path, max(len(data), 1)) != data: raise InputError("Existing immutable member differs: " + path.name, "HDF5_IDENTITY_CHANGED", 409)
        sync_dir(path.parent)
    finally:
        Path(tmp).unlink(missing_ok=True)

def copied(source, target, expected=None, limit=MAX_SOURCE):
    """Copy original bytes through one bounded descriptor without replacing existing data."""
    target = Path(target); fd, temp = tempfile.mkstemp(prefix=".incoming-", dir=target.parent)
    source_fd = None
    try:
        os.fchmod(fd, 0o600)
        source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit: raise InputError("Source must be a regular file within its selected byte limit")
        digest = hashlib.sha256(); count = 0
        with os.fdopen(fd, "wb") as output:
            while block := os.read(source_fd, 1048576):
                count += len(block)
                if count > limit: raise InputError("Source exceeds its selected byte limit")
                output.write(block); digest.update(block)
            output.flush(); os.fsync(output.fileno())
        if identity(before) != identity(os.fstat(source_fd)): raise InputError("Original source changed during retention", "HDF5_SOURCE_CHANGED", 409)
        observed = {"bytes": count, "sha256": digest.hexdigest()}
        if expected is not None and observed != expected: raise InputError("Source bytes differ from the selected identity", "HDF5_IDENTITY_CHANGED", 409)
        try: os.link(temp, target)
        except FileExistsError:
            if file_hash(target, limit) != observed: raise InputError("Retained source path contains another file", "HDF5_IDENTITY_CHANGED", 409)
        sync_dir(target.parent)
        return observed
    finally:
        if source_fd is not None: os.close(source_fd)
        try: os.close(fd)
        except OSError: pass
        Path(temp).unlink(missing_ok=True)
