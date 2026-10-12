# SPDX-License-Identifier: MIT
"""Read-only managed launch binding for the original analyst workspace."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import stat
import sys

SOURCE_ROOT = Path(__file__).resolve().parent.parent
CORE_ROOT = SOURCE_ROOT / "starforge_stac" if (SOURCE_ROOT / "starforge_stac").is_dir() else SOURCE_ROOT
# The complete desktop plugin is flat; received and installed source use the canonical package layout.
sys.path[:0] = [str(SOURCE_ROOT), str(CORE_ROOT.parent)]
from starforge_stac.model import (QgisWorkspace, require, read_json, value_sha,
    file_digest, WORKSPACE_SCHEMA)
from analyst.actions import native_runtime

BINDING_SCHEMA = "starforge.stac-qgis-analyst-binding.v1"
STARTUP_SCHEMA = "starforge.stac-qgis-analyst-startup.v1"
SOURCE_PATHS = (
    "__init__.py", "model.py", "vector_source.py", "qgis_project.py", "plugin.py",
    "cli.py", "metadata.txt", "analyst_state.py",
    "field.py", "field_bridge.py", "field_native.py", "field_ui.py",
)
from starforge_stac.analyst_state import analyst_source_paths

def private_directory(value):
    path = Path(value).expanduser().absolute()
    info = path.lstat()
    require(path.is_dir() and not stat.S_ISLNK(info.st_mode) and
            path.resolve() == path and not (info.st_mode & 0o077),
            "ANALYST_PRIVATE_WORKSPACE", "Select the original canonical private QGIS workspace.")
    require(not path.is_relative_to(SOURCE_ROOT), "ANALYST_WORKSPACE_IN_SOURCE",
            "Keep the project workspace outside its installed product source.")
    return path, info


def source_binding(root=None):
    root = Path(root or SOURCE_ROOT).expanduser().resolve(strict=True)
    files = []
    core_root = root / "starforge_stac" if (root / "starforge_stac").is_dir() else root
    paths = {"starforge_stac/" + name: core_root / name for name in SOURCE_PATHS}
    paths.update(analyst_source_paths(core_root))
    for name, path in sorted(paths.items()):
        require(path.is_file() and not path.is_symlink(), "ANALYST_SOURCE_MISSING",
                "Keep the complete installed analyst and original native source.", path=name)
        require(path.stat().st_size <= 4 * 1024 * 1024, "ANALYST_SOURCE_LIMIT",
                "An installed product module exceeds the supported size.", path=name)
        files.append({"path": name, **file_digest(path)})
    # The canonical PostGIS adapter remains a sibling source component in a full
    # release and a nested package in a received/desktop plugin. Bind its own files.
    postgis_init = core_root / "postgis" / "__init__.py"
    require(postgis_init.is_file() and not postgis_init.is_symlink(),
            "ANALYST_SOURCE_MISSING", "Keep the original PostGIS source adapter.")
    files.append({"path": "starforge_stac/postgis/__init__.py", **file_digest(postgis_init)})
    from starforge_stac import postgis
    adapter_root = Path(postgis.__path__[0]).resolve(strict=True)
    for name in sorted(postgis.software_files()):
        require("/" not in name and "\\" not in name and name not in (".", ".."),
                "ANALYST_SOURCE_MISSING", "Use the original flat PostGIS adapter members.")
        path = adapter_root / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 4 * 1024 * 1024,
                "ANALYST_SOURCE_MISSING", "Keep the complete native PostGIS adapter.", path=name)
        files.append({"path": "postgis-adapter/" + name, "scope": "postgis-adapter", **file_digest(path)})
    files.sort(key=lambda row: row["path"])
    return {"root": str(root), "files": files, "sha256": value_sha(files)}


def inspect_binding(workspace, *, native_runtime_file=None, source_root=None):
    root, info = private_directory(workspace)
    db_path = root / "workspace.sqlite"
    db_info = db_path.lstat()
    require(db_path.is_file() and not stat.S_ISLNK(db_info.st_mode) and not (db_info.st_mode & 0o077),
            "ANALYST_PRIVATE_WORKSPACE", "Use the original private QGIS project database.")
    original = QgisWorkspace(root)
    state = original.read()
    require(state.get("schema") == WORKSPACE_SCHEMA, "ANALYST_WORKSPACE_SCHEMA",
            "Choose an original QGIS project workspace.")
    runtime, runtime_file = {}, None
    if native_runtime_file:
        path = Path(native_runtime_file).expanduser().absolute()
        file_info = path.lstat()
        require(path.is_file() and not stat.S_ISLNK(file_info.st_mode) and not (file_info.st_mode & 0o077),
                "ANALYST_NATIVE_RUNTIME_FILE", "Select the original private native runtime JSON file.")
        value, _ = read_json(path, limit=65536)
        runtime = native_runtime(value)
        runtime_file = {"path": str(path), **file_digest(path)}
    source = source_binding(source_root)
    after, database = root.stat(), db_path.stat()
    require((info.st_dev, info.st_ino) == (after.st_dev, after.st_ino) and
            (db_info.st_dev, db_info.st_ino) == (database.st_dev, database.st_ino),
            "ANALYST_WORKSPACE_CHANGED", "The selected original project changed during launch inspection.")
    body = {"schema": BINDING_SCHEMA, "workspaceDirectory": str(root), "workspaceId": state["id"],
            "workspaceIdentity": {"device": str(info.st_dev), "inode": str(info.st_ino),
                                  "databaseDevice": str(db_info.st_dev), "databaseInode": str(db_info.st_ino)},
            "python": {"executable": str(Path(sys.executable).resolve()),
                       "version": list(sys.version_info[:3])},
            "nativeRuntime": runtime, "nativeRuntimeFile": runtime_file,
            "sourceSha256": source["sha256"], "sourceFiles": source["files"]}
    return {**body, "sha256": value_sha(body), "sourceRoot": source["root"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--source-root")
    args = parser.parse_args(argv)
    value = inspect_binding(args.workspace, native_runtime_file=args.native_runtime_file,
                            source_root=args.source_root)
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": getattr(exc, "code", type(exc).__name__),
                          "message": str(exc), "details": getattr(exc, "details", {})}), file=sys.stderr)
        raise SystemExit(2)
