"""MIT. Bind the original Utility workspace and source to managed Applications."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import pyexpat
import sqlite3
import sys

from utility_shared import HERE, InputError, json_bytes, load_json

SCHEMA = "stellar-forge.utility-managed-binding.v1"
STARTUP = "stellar-forge.utility-workspace-launch.v1"
APPLICATION = "stellar-forge.utility-workspace.v1"
SOURCE = HERE.parent
SOURCE_FILES = (
    "utility-energy/application-provider.mjs",
    "utility-energy/managed-application.mjs",
    "utility-energy/managed.py",
    "utility-energy/cli.mjs",
    "utility-energy/cli.py",
    "utility-energy/utility-client.mjs",
    "utility-energy/utility_shared.py",
    "utility-energy/utility_source.py",
    "utility-energy/utility_time.py",
    "utility-energy/utility_contracts.py",
    "utility-energy/utility_analysis.py",
    "utility-energy/utility_workspace.py",
    "utility-energy/utility_api.py",
    "utility-energy/utility_delivery.py",
    "utility-energy/utility_publisher.py",
    "utility-energy/utility_server.py",
    "utility-energy/public/app.js",
    "utility-energy/public/index.html",
    "utility-energy/public/style.css",
    "utility-energy/contracts/source-contracts.json",
    "utility-energy/contracts/espi-4.0.xsd",
    "utility-energy/contracts/atom-4.1.xsd",
    "clinicaltrials/publisher-bridge.mjs",
)


def source_engine():
    """Reuse the original read-only NDJSON identity inspector."""
    name = "_utility_original_ndjson_managed"
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, SOURCE / "ndjson" / "managed.py")
        if spec is None or spec.loader is None:
            raise InputError("The complete original NDJSON managed source is required")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        sys.modules[name] = module
    return module


def inspect_binding(directory):
    original = source_engine()
    base = original.inspect_binding(directory)
    root = Path(base["workspace"])
    for name in ("utility", "exports", "utility/originals", "utility/imports",
                 "utility/previews", "utility/reviews", "utility/reconciliations", "utility/captures"):
        path = root / name
        if path.is_symlink() or not path.is_dir():
            raise InputError("Choose the initialized Utility workspace; missing " + name)
    database = root / "workspace.sqlite"
    before = original.regular(database, private=True)
    connection = None
    try:
        connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)
        connection.execute("PRAGMA query_only=ON")
        row = connection.execute("SELECT body FROM utility_meta WHERE k=?", ("application",)).fetchone()
        if row is None or load_json(row[0]) != APPLICATION:
            raise InputError("Choose a workspace initialized or received by the original Utility command")
    except sqlite3.Error as error:
        raise InputError("The original Utility workspace could not be read: " + str(error)) from error
    finally:
        if connection is not None:
            connection.close()
    after = original.regular(database, private=True)
    if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
        raise InputError("The original Utility workspace changed during review")
    version = list(pyexpat.version_info)
    if tuple(version) < (2, 6, 0):
        raise InputError("Select the original XML runtime with Expat 2.6 or newer")
    value = {key: item for key, item in base.items() if key != "sha256"}
    value.update(
        schema=SCHEMA,
        applicationSchema=APPLICATION,
        source={**base["source"], **{name: original.source_digest(SOURCE / name) for name in SOURCE_FILES}},
        parser={"name": "expat", "version": version, "versionString": pyexpat.EXPAT_VERSION},
    )
    # Saved input, review, query and customer records remain mutable in the native
    # database. The same source may move into an adopted immutable release.
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": original.digest(json_bytes(bound))}


def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and (
            not isinstance(expected, str) or len(expected) != 64
            or any(char not in "0123456789abcdef" for char in expected)
            or value["sha256"] != expected):
        raise InputError("The selected Utility workspace, Python, XML parser or source changed; review this application again")
    return value


def startup(server, binding, connection_file=None):
    value = {
        "schema": STARTUP, "status": "UTILITY_WORKSPACE_READY",
        "workspace": binding["workspace"], "applicationSchema": APPLICATION,
        "bindingSha256": binding["sha256"], "workspaceIdentity": binding["workspaceIdentity"],
        "sourceRoot": binding["sourceRoot"], "python": binding["python"], "parser": binding["parser"],
        "pid": os.getpid(), "console": server.url,
    }
    if connection_file is not None:
        value["connectionFile"] = str(Path(connection_file).expanduser().absolute())
    return value
