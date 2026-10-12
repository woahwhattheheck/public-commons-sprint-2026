# SPDX-License-Identifier: MIT
"""Bind the original publication, native host selection and installed source for Applications."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import stat
import sys

from contract import (HERE, SOURCE, SHA, need, directory, read_json, json_bytes, digest,
                      value_hash, measure, atomic, sync_directory, relative)
from workspace import QwcWorkspace, source_inventory
from generator import native_source_inventory
from portable import inspect_received

BINDING_SCHEMA = "starforge.stac-qwc-managed-binding.v1"
STARTUP_SCHEMA = "starforge.stac-qwc-launch.v1"


def private_file(path):
    path = Path(path)
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink() and
         (os.name != "posix" or info.st_uid == os.getuid() and info.st_mode & 0o077 == 0),
         "PRIVATE_OPERATOR_FILE", "Keep original operator metadata private and owned by this operator.")
    return info


def executable_identity(path):
    path = Path(path).expanduser().absolute()
    resolved = path.resolve(strict=True)
    observed = resolved.stat()
    need(resolved.is_file() and os.access(resolved, os.X_OK), "NATIVE_EXECUTABLE_REQUIRED",
         "Select the original existing native Python executable.", path=str(path))
    return {"path": str(path), "resolvedPath": str(resolved), "device": str(observed.st_dev),
            "inode": str(observed.st_ino), "bytes": observed.st_size,
            "modifiedNs": str(observed.st_mtime_ns)}


def inspect_binding(root, *, received=False, qgis_python=None):
    need(sys.version_info >= (3, 11), "PYTHON_VERSION", "The operator requires Python 3.11 or newer.")
    original = Path(root).expanduser().absolute()
    root = directory(root)
    need(original == root, "ORIGINAL_DIRECTORY_REQUIRED", "Select the original absolute operator directory without aliases.")
    info = root.stat()
    need(os.name != "posix" or info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
         "PRIVATE_OPERATOR_DIRECTORY", "Keep this original operator directory private.")
    if received:
        selected = inspect_received(root, verify=False)
        marker_path = root / "received-package.json"
        workspace_id = selected["receipt"]["publicationId"]
        native = {"qgisPython": executable_identity(qgis_python)} if qgis_python else {}
        host_source = None
    else:
        workspace = QwcWorkspace(root)
        marker_path = root / "workspace.json"
        workspace_id = workspace.marker["id"]
        profile = workspace.profile
        native = {key: executable_identity(profile[key]) for key in ("qgisPython", "generatorPython")}
        host_source = {"root": profile["generatorSource"],
                       "files": native_source_inventory(profile["generatorSource"])}
    marker_info = private_file(marker_path)
    marker = measure(marker_path)
    files = {}
    for base in (HERE, HERE.parent / "qgis"):
        for row in source_inventory(base):
            name = (base / row["path"]).relative_to(SOURCE).as_posix()
            files[relative(name)] = row["sha256"]
    value = {"schema": BINDING_SCHEMA, "mode": "received" if received else "publisher",
             "workspace": str(root), "workspaceId": workspace_id, "sourceRoot": str(SOURCE),
             "workspaceIdentity": {"device": str(info.st_dev), "inode": str(info.st_ino),
                                   "markerPath": marker_path.name, "markerSha256": marker["sha256"],
                                   "markerDevice": str(marker_info.st_dev), "markerInode": str(marker_info.st_ino)},
             "python": {"executable": str(Path(sys.executable).absolute()), "prefix": sys.prefix,
                        "basePrefix": sys.base_prefix, "implementation": sys.implementation.name,
                        "version": list(sys.version_info[:3])},
             "nativeExecutables": native, "generatorSource": host_source, "source": files}
    return value | {"sha256": value_hash({k: v for k, v in value.items() if k != "sourceRoot"})}


def require_binding(root, expected=None, *, received=False, qgis_python=None):
    result = inspect_binding(root, received=received, qgis_python=qgis_python)
    if expected is not None:
        need(isinstance(expected, str) and SHA.fullmatch(expected) and result["sha256"] == expected,
             "OPERATOR_BINDING_CHANGED",
             "The original workspace, Python, native host or installed source changed. Review this application again.")
    return result


def startup(server, binding, connection_file=None):
    value = {"schema": STARTUP_SCHEMA, "status": "QWC_OPERATOR_READY",
             "mode": binding["mode"], "workspace": binding["workspace"],
             "workspaceId": binding["workspaceId"], "bindingSha256": binding["sha256"],
             "sourceRoot": binding["sourceRoot"], "python": binding["python"],
             "pid": os.getpid(), "console": server.url}
    if connection_file is not None:
        value["connectionFile"] = str(connection_file)
    return value


@contextmanager
def published_connection(filename, url):
    if filename is None:
        yield None
        return
    path = Path(filename).expanduser().absolute()
    need(path.parent.is_dir() and not path.exists() and not path.is_symlink(),
         "NEW_CONNECTION_FILE", "Choose a new private connection file beside an existing directory.")
    body = (url + "\n").encode("utf-8")
    atomic(path, body, create_only=True)
    try:
        yield str(path)
    finally:
        if path.exists() and not path.is_symlink():
            private_file(path)
            if path.read_bytes() == body:
                path.unlink()
                sync_directory(path.parent)
