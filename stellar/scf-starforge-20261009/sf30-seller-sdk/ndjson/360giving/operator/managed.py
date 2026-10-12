"""MIT. Original publisher identity and startup within the Applications lifecycle."""
from __future__ import annotations

import hashlib
from importlib.metadata import version
import os
from pathlib import Path
import shutil
import stat
import sys
import uuid

import jsonschema

from publisher_workspace import (
    InputError, SCHEMA, SDK, STORES, encoded, load_json, runtime_files,
)

BINDING = "stellar-forge.360giving-managed-binding.v1"
STARTUP = "stellar-forge.360giving-console.v1"


def regular_bytes(path, *, private=False, limit=4 * 1024 * 1024):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise InputError("Select a complete original publisher file: " + str(path))
    if private and os.name == "posix" and (
            before.st_uid != os.getuid() or before.st_mode & 0o077):
        raise InputError("Publisher connection and workspace metadata must remain private")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise InputError("The original publisher file changed while opening")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    current = path.lstat()
    fields = lambda item: (item.st_dev, item.st_ino, item.st_size,
                           item.st_mtime_ns, item.st_ctime_ns)
    if len(data) != before.st_size or len(data) > limit or (
            fields(before) != fields(after) or fields(after) != fields(current)):
        raise InputError("The original publisher file changed while reading")
    return data, before


def node_identity():
    selected = os.environ.get("SF30_XML_NODE", "node")
    executable = shutil.which(selected)
    if not executable:
        raise InputError("The selected native Node executable could not be found: " + selected)
    path = Path(executable).resolve(strict=True)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or not os.access(path, os.X_OK):
        raise InputError("Select the existing native Node executable")
    return {"executable": str(path), "device": str(info.st_dev), "inode": str(info.st_ino),
            "bytes": info.st_size, "mtimeNs": str(info.st_mtime_ns),
            "ctimeNs": str(info.st_ctime_ns)}


def inspect_binding(directory):
    """Read original identity without taking its writer or changing saved requests."""
    raw = Path(directory).expanduser().absolute()
    root = raw.resolve(strict=True)
    info = root.stat()
    if raw != root or not stat.S_ISDIR(info.st_mode):
        raise InputError("Select the original absolute publisher workspace without aliases")
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Select the original private, operator-owned publisher workspace")
    data, marker = regular_bytes(root / "workspace.json", private=True, limit=4096)
    saved = load_json(data)
    try:
        valid_id = str(uuid.UUID(saved["id"])) == saved["id"]
    except (KeyError, ValueError, TypeError, AttributeError):
        valid_id = False
    if not isinstance(saved, dict) or saved.get("schema") != SCHEMA or not valid_id:
        raise InputError("Initialize or receive this workspace with the original 360Giving command")
    for name in STORES:
        path = root / name
        member = path.lstat()
        if not stat.S_ISDIR(member.st_mode) or stat.S_ISLNK(member.st_mode):
            raise InputError("Original publisher storage is missing: " + name)
    if sys.version_info < (3, 11):
        raise InputError("The publisher workspace requires Python 3.11 or newer")
    source = {}
    for name, path in sorted(runtime_files().items()):
        raw_source, _ = regular_bytes(path)
        source[name.removeprefix("runtime/sf30-seller-sdk/")] = hashlib.sha256(raw_source).hexdigest()
    dependency = Path(jsonschema.__file__).resolve(strict=True)
    dependency_bytes, _ = regular_bytes(dependency)
    value = {
        "schema": BINDING, "workspace": str(root), "workspaceId": saved["id"],
        "sourceRoot": str(SDK),
        "workspaceIdentity": {
            "device": str(info.st_dev), "inode": str(info.st_ino),
            "markerDevice": str(marker.st_dev), "markerInode": str(marker.st_ino),
            "markerSha256": hashlib.sha256(data).hexdigest(),
        },
        "python": {
            "executable": str(Path(sys.executable).absolute()), "prefix": sys.prefix,
            "basePrefix": sys.base_prefix, "implementation": sys.implementation.name,
            "version": list(sys.version_info[:3]),
        },
        "node": node_identity(),
        "dependencies": {"jsonschema": {
            "version": version("jsonschema"), "module": str(dependency),
            "sha256": hashlib.sha256(dependency_bytes).hexdigest(),
        }},
        "source": source,
    }
    current = root.stat()
    if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
        raise InputError("The original publisher directory changed while reading")
    if regular_bytes(root / "workspace.json", private=True, limit=4096)[0] != data:
        raise InputError("The original publisher identity changed while reading")
    # Adoption relocates complete source; its relative bytes and actual workspace stay bound.
    core = {key: item for key, item in value.items() if key != "sourceRoot"}
    return {**value, "sha256": hashlib.sha256(encoded(core)).hexdigest()}


def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and expected != value["sha256"]:
        raise InputError("The selected publisher, Python or native source changed; review this application again")
    return value


def launch_record(server, binding):
    return {
        "schema": STARTUP, "status": "360GIVING_WORKSPACE_READY",
        "workspace": str(server.workspace.root), "workspaceId": server.workspace.binding["id"],
        "pid": os.getpid(), "url": server.url,
        "bindingSha256": binding["sha256"], "sourceRoot": binding["sourceRoot"],
        "python": binding["python"], "node": binding["node"],
    }
