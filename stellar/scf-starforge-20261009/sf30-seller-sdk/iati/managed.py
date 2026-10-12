"""MIT. Retained IATI workspace identity and managed original console startup."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import stat
import sys

from iati_workspace import InputError, json_bytes, load_json

SCHEMA = "stellar-forge.iati-managed-binding.v1"
STARTUP = "stellar-forge.iati-workspace-launch.v1"
SOURCE = Path(__file__).resolve().parents[1]
SOURCE_FILES = (
    "iati/iati_source.py", "iati/iati_workspace.py", "iati/server.py",
    "iati/cli.py", "iati/cli.mjs", "iati/managed.py",
    "iati/public/index.html", "iati/public/app.js", "iati/public/style.css",
    "xml/xml_source.py", "xml/workspace.py", "xml/server.py", "xml/native.mjs",
    "dataset-handler.mjs",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, *, private=False, limit=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or limit is not None and info.st_size > limit:
        raise InputError("Choose an original regular IATI workspace or source file: " + str(path))
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("IATI workspace metadata must remain private and operator-owned")
    return info


def source_digest(path):
    info = regular(path, limit=4 * 1024 * 1024)
    value = hashlib.sha256()
    with path.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise InputError("Original IATI source changed while opening")
        for data in iter(lambda: handle.read(65536), b""):
            value.update(data)
        after = os.fstat(handle.fileno())
    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        raise InputError("Original IATI source changed while reading")
    return value.hexdigest()


def inspect_binding(directory):
    """Read saved identity without acquiring the original SQLite writer."""
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    if raw != root or root.is_symlink():
        raise InputError("Choose the original absolute IATI workspace without path aliases")
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == "posix" and (
            info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Choose the original private, operator-owned IATI workspace")
    marker = root / "workspace.json"
    marker_info = regular(marker, private=True, limit=4096)
    data = marker.read_bytes()
    if load_json(data) != {"schema": "stellar-forge.iati-workspace.v1"}:
        raise InputError("Choose a workspace initialized or received by the original IATI command")
    database = regular(root / "workspace.sqlite", private=True)
    for name in ("sources", "plans", "builds", "comparisons", "tmp"):
        item = root / name
        if item.is_symlink() or not item.is_dir():
            raise InputError("Original IATI storage directory is missing: " + name)
    if sys.version_info < (3, 11):
        raise InputError("The original IATI workspace requires Python 3.11 or newer")
    value = {
        "schema": SCHEMA, "workspace": str(root), "sourceRoot": str(SOURCE),
        "workspaceIdentity": {
            "device": str(info.st_dev), "inode": str(info.st_ino),
            "markerDevice": str(marker_info.st_dev), "markerInode": str(marker_info.st_ino),
            "markerSha256": digest(data),
            "databaseDevice": str(database.st_dev), "databaseInode": str(database.st_ino),
        },
        "python": {
            "executable": str(Path(sys.executable).absolute()), "prefix": sys.prefix,
            "basePrefix": sys.base_prefix, "implementation": sys.implementation.name,
            "version": list(sys.version_info[:3]),
        },
        "source": {name: source_digest(SOURCE / name) for name in SOURCE_FILES},
    }
    # Managed adoption copies the same source into its retained release.
    # Saved source rows and edition records remain mutable in the original database.
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": digest(json_bytes(bound))}


def require_binding(directory, expected):
    value = inspect_binding(directory)
    if expected is not None and (
            not isinstance(expected, str) or len(expected) != 64
            or any(char not in "0123456789abcdef" for char in expected)
            or expected != value["sha256"]):
        raise InputError("The selected IATI workspace, Python or original source changed; review this application again")
    return value


def startup(server, binding, connection_file=None):
    value = {
        "schema": STARTUP, "status": "IATI_WORKSPACE_READY",
        "workspace": binding["workspace"], "bindingSha256": binding["sha256"],
        "sourceRoot": binding["sourceRoot"], "python": binding["python"],
        "pid": os.getpid(), "console": server.url,
    }
    if connection_file is not None:
        value["connectionFile"] = connection_file
    return value
