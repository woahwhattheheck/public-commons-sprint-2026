"""Managed launch of the original Aviary workspace and operator server."""
from __future__ import annotations

import os
from pathlib import Path
import re
import sys
import uuid

import aviary as a

BINDING_SCHEMA = "stellar-forge.aviary-managed-binding.v1"
STARTUP_SCHEMA = "stellar-forge.aviary-workspace-launch.v1"
SOURCE_FILES = (
    "APPLICATIONS.md", "PROVIDER_CONTRACT.md", "README.md", "app.js",
    "aviary.py", "aviary_client.py", "cli.mjs", "index.html", "managed.py",
    "server.py",
)


def source_hashes():
    root = Path(__file__).resolve().parent
    values = {}
    for name in SOURCE_FILES:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise a.Problem("APPLICATION_SOURCE", "Retain the complete original Aviary application.", name)
        values[name] = a.fingerprint(path)["sha256"]
    return root, values


def binding(workspace):
    if sys.version_info < (3, 11):
        raise a.Problem("PYTHON_VERSION", "Select the existing Python 3.11 or later executable.")
    root = Path(workspace).resolve()
    if not root.is_dir():
        raise a.Problem("WORKSPACE", "Select an initialized or received Aviary workspace.")
    database = root / "aviary.sqlite3"
    marker = root / "source-manifest.json"
    if not database.is_file() or database.is_symlink() or not marker.is_file() or marker.is_symlink():
        raise a.Problem("WORKSPACE", "Retain the original workspace database and source manifest.")
    db = a.connect(root)
    try:
        identity, source = a.meta(db, "identity"), a.meta(db, "source")
    finally:
        db.close()
    if not isinstance(identity, dict) or not isinstance(source, dict):
        raise a.Problem("WORKSPACE_BINDING", "Retain the original workspace identity and source records.")
    try:
        valid_id = str(uuid.UUID(identity.get("id", ""))) == identity.get("id")
    except (ValueError, TypeError, AttributeError):
        valid_id = False
    if (identity.get("schema") != "stellar-forge.aviary-workspace.v1"
            or not valid_id
            or source != a.read_json(marker)
            or identity.get("sourceManifestSha256") != a.digest(source)):
        raise a.Problem("WORKSPACE_BINDING", "The original workspace identity and source manifest differ.")
    source_root, sources = source_hashes()
    directory_info, database_info = root.stat(), database.stat()
    value = {
        "schema": BINDING_SCHEMA,
        "workspace": str(root),
        "workspaceId": identity["id"],
        "workspaceIdentity": {
            "device": str(directory_info.st_dev), "inode": str(directory_info.st_ino),
            "databaseDevice": str(database_info.st_dev), "databaseInode": str(database_info.st_ino),
            "identitySha256": a.digest(identity),
            "sourceManifestSha256": a.digest(source),
            "sourceManifestFileSha256": a.fingerprint(marker)["sha256"],
        },
        "sourceRoot": str(source_root),
        "source": sources,
        "python": {
            "executable": os.path.realpath(sys.executable),
            "version": list(sys.version_info[:3]),
        },
    }
    return value | {"sha256": a.digest(value)}


def serve(workspace, port=0, expected_binding=None):
    if not isinstance(expected_binding, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_binding):
        raise a.Problem("MANAGED_BINDING", "Review the original workspace and pass its complete binding SHA-256.")
    selected = binding(workspace)
    if selected["sha256"] != expected_binding:
        raise a.Problem("MANAGED_BINDING_CHANGED",
                        "The workspace, native source or selected Python changed after review.")
    from server import serve as serve_original
    return serve_original(workspace, port, managed={
        "schema": STARTUP_SCHEMA,
        "status": "AVIARY_WORKSPACE_READY",
        "workspaceId": selected["workspaceId"],
        "bindingSha256": selected["sha256"],
        "sourceRoot": selected["sourceRoot"],
        "source": selected["source"],
        "python": selected["python"],
    }, expected_identity=selected["workspaceIdentity"]["identitySha256"])
