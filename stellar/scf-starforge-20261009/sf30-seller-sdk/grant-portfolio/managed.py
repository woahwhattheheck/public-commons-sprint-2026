"""MIT. Bind the original portfolio source, Python and saved workspace for Applications."""
from __future__ import annotations
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import urlsplit

SCHEMA = "stellar-forge.grant-portfolio-managed-binding.v1"
STARTUP = "stellar-forge.grant-portfolio-workspace-launch.v1"
MARKER_SCHEMA = "stellar-forge.grant-portfolio-workspace.v1"
SOURCE_MANIFEST_SCHEMA = "stellar-forge.grant-portfolio-source-files.v1"
SOURCE = Path(__file__).resolve().parents[1]
SOURCE_MANIFEST = "grant-portfolio/source-files.json"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class BindingError(ValueError):
    code = "GRANT_PORTFOLIO_BINDING_CHANGED"


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _regular(path, *, private=False, limit=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or limit is not None and info.st_size > limit:
        raise BindingError("Choose an original regular portfolio or source file: " + str(path))
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise BindingError("Portfolio metadata must remain private and operator-owned")
    return info


def _read(path, *, private=False, limit=32 * 1024 * 1024):
    info = _regular(path, private=private, limit=limit)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size) != (info.st_dev, info.st_ino, info.st_size):
            raise BindingError("Original source or metadata changed while opening")
        data = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    attached = path.lstat()
    if len(data) != info.st_size or len(data) > limit or (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            info.st_size, info.st_mtime_ns, info.st_ctime_ns) or (
            attached.st_dev, attached.st_ino) != (info.st_dev, info.st_ino):
        raise BindingError("Original source or metadata changed during reading")
    return data, info


def sourceFileList():
    """Return the exact SDK-relative bound source closure used by the bridge and exporter."""
    raw, _ = _read(SOURCE / SOURCE_MANIFEST, limit=1024 * 1024)
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise BindingError("The original source-file manifest is not complete JSON") from error
    if not isinstance(value, dict) or set(value) != {"schema", "files"} or value["schema"] != SOURCE_MANIFEST_SCHEMA:
        raise BindingError("Choose the original portfolio source-file manifest")
    files = value["files"]
    if not isinstance(files, list) or not files or len(files) > 2048:
        raise BindingError("The complete original source closure must be a file list")
    if not all(isinstance(name, str) and name and len(name) <= 512 and
               not any(ord(char) < 32 for char in name) and "\\" not in name and
               not PurePosixPath(name).is_absolute() and
               all(part not in ("", ".", "..") for part in name.split("/"))
               for name in files):
        raise BindingError("Source files must be original SDK-relative paths")
    if files != sorted(set(files)) or SOURCE_MANIFEST not in files or "grant-portfolio/managed.py" not in files:
        raise BindingError("The complete source list must retain its unique manifest and managed binding")
    for name in files:
        path = SOURCE / name
        if path.resolve(strict=True) != path:
            raise BindingError("Original source files cannot use symlink or path aliases")
    return tuple(files)


def inspect_binding(directory):
    """Read saved identities and original bytes without acquiring the workspace writer."""
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    if raw != root or root.is_symlink():
        raise BindingError("Choose the original absolute portfolio workspace without path aliases")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (
            info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise BindingError("Choose the original private operator-owned portfolio workspace")
    data, marker = _read(root / "workspace.json", private=True, limit=4096)
    try:
        metadata = json.loads(data)
    except (ValueError, UnicodeError) as error:
        raise BindingError("The saved original workspace marker is incomplete") from error
    if not isinstance(metadata, dict) or set(metadata) != {"schema", "workspaceId", "createdAt"} or (
            metadata["schema"] != MARKER_SCHEMA or not isinstance(metadata["workspaceId"], str) or
            not UUID.fullmatch(metadata["workspaceId"]) or not isinstance(metadata["createdAt"], str)):
        raise BindingError("Choose a workspace initialized or received by the original portfolio command")
    try:
        created = dt.datetime.fromisoformat(metadata["createdAt"].replace("Z", "+00:00"))
        if created.tzinfo is None:
            raise ValueError("missing original timezone")
    except ValueError as error:
        raise BindingError("The original workspace creation time is invalid") from error
    database = _regular(root / "workspace.sqlite", private=True)
    lock = _regular(root / ".workspace.lock", private=True)
    if sys.version_info < (3, 11):
        raise BindingError("The original portfolio workspace requires Python 3.11 or newer")
    files = sourceFileList()
    source = {name: digest(_read(SOURCE / name)[0]) for name in files}
    # Recheck the closure declaration after all original source bytes are inspected.
    if digest(_read(SOURCE / SOURCE_MANIFEST)[0]) != source[SOURCE_MANIFEST]:
        raise BindingError("The original source declaration changed during inspection")
    value = {
        "schema": SCHEMA, "workspace": str(root), "workspaceId": metadata["workspaceId"],
        "sourceRoot": str(SOURCE),
        "workspaceIdentity": {
            "device": str(info.st_dev), "inode": str(info.st_ino),
            "markerDevice": str(marker.st_dev), "markerInode": str(marker.st_ino),
            "markerSha256": digest(data),
            "databaseDevice": str(database.st_dev), "databaseInode": str(database.st_ino),
            "lockDevice": str(lock.st_dev), "lockInode": str(lock.st_ino),
        },
        "python": {
            "executable": str(Path(sys.executable).absolute()), "prefix": sys.prefix,
            "basePrefix": sys.base_prefix, "implementation": sys.implementation.name,
            "version": list(sys.version_info[:3]),
        },
        "source": source,
    }
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": digest(json_bytes(bound))}


def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and (not isinstance(expected, str) or
            not re.fullmatch(r"[0-9a-f]{64}", expected) or expected != value["sha256"]):
        raise BindingError("The selected workspace, Python or original source changed; review this application again")
    return value



def connection_record(filename, binding):
    """Inspect an owned original launch without removing it or exposing its token."""
    selected = Path(filename).expanduser().absolute()
    if selected.parent.resolve(strict=True) != selected.parent:
        raise BindingError("Use the original private connection directory")
    parent = selected.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise BindingError("Keep the original connection in a private operator-owned directory")
    try:
        data, info = _read(selected, private=True, limit=32768)
    except FileNotFoundError:
        return {"exists": False, "path": str(selected)}
    try:
        value = json.loads(data)
    except (ValueError, UnicodeError) as error:
        raise BindingError("The retained connection is not an original complete launch") from error
    keys = {"schema", "status", "workspace", "workspaceId", "bindingSha256", "sourceRoot",
            "python", "pid", "console", "connectionFile"}
    if not isinstance(value, dict) or set(value) != keys or value["schema"] != STARTUP or (
            value["status"] != "GRANT_PORTFOLIO_WORKSPACE_READY"
            or value["workspace"] != binding["workspace"]
            or value["workspaceId"] != binding["workspaceId"]
            or value["connectionFile"] != str(selected)
            or not isinstance(value["bindingSha256"], str)
            or not re.fullmatch(r"[0-9a-f]{64}", value["bindingSha256"])
            or not isinstance(value["sourceRoot"], str)
            or not Path(value["sourceRoot"]).is_absolute()
            or not isinstance(value["python"], dict)
            or not isinstance(value["pid"], int) or isinstance(value["pid"], bool) or value["pid"] <= 0
            or not isinstance(value["console"], str) or info.st_nlink != 1):
        raise BindingError("The existing connection belongs to a different original workspace or launch")
    try:
        url = urlsplit(value["console"])
        valid = (url.scheme == "http" and url.hostname == "127.0.0.1" and
                 isinstance(url.port, int) and 1 <= url.port <= 65535 and
                 not url.username and not url.password and url.path == "/" and not url.query and
                 re.fullmatch(r"[A-Za-z0-9_-]{43}", url.fragment))
    except ValueError:
        valid = False
    if not valid:
        raise BindingError("The retained original console link is invalid")
    # A stopped launch may belong to the previous reviewed source release. The
    # unchanged native workspace path and UUID, private file and kernel lease
    # determine custody; its old binding stays visible in the returned record.
    return {"exists": True, "path": str(selected), "bytes": len(data), "sha256": digest(data),
            "device": str(info.st_dev), "inode": str(info.st_ino),
            "workspace": binding["workspace"], "workspaceId": binding["workspaceId"],
            "originalBindingSha256": value["bindingSha256"]}


def inspect_connection(directory, filename):
    """Read the actual original writer lease; PID reuse never selects an owner."""
    binding = require_binding(directory)
    record = connection_record(filename, binding)
    lock = Path(binding["workspace"]) / ".workspace.lock"
    info = _regular(lock, private=True)
    descriptor = os.open(lock, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise BindingError("The original workspace writer lease changed")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            active = True
        else:
            active = False
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        attached = lock.lstat()
        if (attached.st_dev, attached.st_ino) != (info.st_dev, info.st_ino):
            raise BindingError("The original workspace writer lease changed during inspection")
    finally:
        os.close(descriptor)
    after = connection_record(filename, binding)
    if after != record:
        raise BindingError("The original connection changed during writer inspection")
    return {"schema": "stellar-forge.grant-portfolio-connection-state.v1",
            "workspace": binding["workspace"], "workspaceId": binding["workspaceId"],
            "bindingSha256": binding["sha256"], "writerActive": active, **record}


def startup(server, binding, connection_file=None):
    value = {
        "schema": STARTUP, "status": "GRANT_PORTFOLIO_WORKSPACE_READY",
        "workspace": binding["workspace"], "workspaceId": binding["workspaceId"],
        "bindingSha256": binding["sha256"], "sourceRoot": binding["sourceRoot"],
        "python": binding["python"], "pid": os.getpid(), "console": server.url,
    }
    if connection_file is not None:
        value["connectionFile"] = str(connection_file)
    return value
