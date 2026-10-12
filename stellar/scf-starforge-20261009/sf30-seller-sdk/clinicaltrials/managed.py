"""MIT. Original ClinicalTrials workspace and Python binding for managed Applications."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sqlite3
import sys

from clinical_shared import HERE, InputError, json_bytes, load_json
import clinical_prs as prs

SCHEMA = "stellar-forge.clinicaltrials-managed-binding.v1"
STARTUP = "stellar-forge.clinicaltrials-workspace-launch.v1"
APPLICATION = "stellar-forge.clinicaltrials-workspace.v1"
SOURCE = HERE.parent
SOURCE_FILES = (
    "clinicaltrials/application-provider.mjs",
    "clinicaltrials/cli.mjs",
    "clinicaltrials/cli.py",
    "clinicaltrials/clinical_batch.py",
    "clinicaltrials/clinical_package.py",
    "clinicaltrials/clinical_prs.py",
    "clinicaltrials/clinical_server.py",
    "clinicaltrials/clinical_shared.py",
    "clinicaltrials/clinical_source.py",
    "clinicaltrials/clinical_workspace.py",
    "clinicaltrials/contracts/ProtocolRecordSchema.xsd",
    "clinicaltrials/contracts/RRSUploadSchema.xsd",
    "clinicaltrials/contracts/api-contract.json",
    "clinicaltrials/contracts/clinicaltrials-openapi.yaml",
    "clinicaltrials/contracts/source-contracts.json",
    "clinicaltrials/managed-application.mjs",
    "clinicaltrials/managed.py",
    "clinicaltrials/prs/__init__.py",
    "clinicaltrials/prs/__main__.py",
    "clinicaltrials/prs/errors.py",
    "clinicaltrials/prs/modernization.py",
    "clinicaltrials/prs/profiles/nlm-20261012.json",
    "clinicaltrials/prs/reconcile.py",
    "clinicaltrials/prs/schema.py",
    "clinicaltrials/prs/schemas/ProtocolRecordSchema.xsd",
    "clinicaltrials/prs/schemas/RRSUploadSchema.xsd",
    "clinicaltrials/prs/schemas/clinicaltrials-openapi.yaml",
    "clinicaltrials/prs/schemas/source-contracts.json",
    "clinicaltrials/prs/upload.py",
    "clinicaltrials/public/app.js",
    "clinicaltrials/public/batch.js",
    "clinicaltrials/public/index.html",
    "clinicaltrials/public/style.css",
    "clinicaltrials/publisher-bridge.mjs",
)

# Reuse the original NDJSON workspace/source inspector. It never opens a writer
# or creates a Workspace. A separate module name avoids the two managed.py names.
def source_engine():
    name = "_clinical_original_ndjson_managed"
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
    for name in ("registry", "prs", "exports"):
        path = root / name
        if path.is_symlink() or not path.is_dir():
            raise InputError("Choose the original initialized ClinicalTrials workspace; missing " + name)
    database = root / "workspace.sqlite"
    before = original.regular(database, private=True)
    connection = None
    try:
        connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)
        connection.execute("PRAGMA query_only=ON")
        row = connection.execute("SELECT body FROM registry_meta WHERE k=?", ("application",)).fetchone()
        if row is None or load_json(row[0]) != APPLICATION:
            raise InputError("Choose a workspace initialized or received by the original ClinicalTrials command")
    except sqlite3.Error as error:
        raise InputError("The original ClinicalTrials workspace could not be read: " + str(error)) from error
    finally:
        if connection is not None:
            connection.close()
    after = original.regular(database, private=True)
    if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
        raise InputError("The original ClinicalTrials workspace changed during review")

    report = prs.doctor()
    if report.get("ready") is not True:
        raise InputError("The selected Python must load the original PRS schemas and declared lxml dependency: "
                         + str(report.get("error") or "PRS is not ready"))
    selected = {
        "schema": report["schema"], "lxmlVersion": report["lxmlVersion"],
        "libxmlVersion": report["libxmlVersion"], "schemaSetSha256": report["schemaSetSha256"],
    }
    value = {key: item for key, item in base.items() if key != "sha256"}
    value.update(
        schema=SCHEMA,
        applicationSchema=APPLICATION,
        source={**base["source"], **{name: original.source_digest(SOURCE / name) for name in SOURCE_FILES}},
        prs=selected,
    )
    # Mutable source rows, reviews, PRS plans and customer results remain in the
    # original database. Adoption may copy identical code into another release.
    bound = {key: item for key, item in value.items() if key != "sourceRoot"}
    return value | {"sha256": original.digest(json_bytes(bound))}


def require_binding(directory, expected=None):
    value = inspect_binding(directory)
    if expected is not None and (
            not isinstance(expected, str) or len(expected) != 64
            or any(char not in "0123456789abcdef" for char in expected)
            or value["sha256"] != expected):
        raise InputError("The selected ClinicalTrials workspace, Python, PRS or source changed; review this application again")
    return value


def startup(server, binding, connection_file=None):
    value = {
        "schema": STARTUP, "status": "CLINICALTRIALS_WORKSPACE_READY",
        "workspace": binding["workspace"], "applicationSchema": APPLICATION,
        "bindingSha256": binding["sha256"], "sourceRoot": binding["sourceRoot"],
        "python": binding["python"], "prs": binding["prs"],
        "pid": os.getpid(), "console": server.url,
    }
    if connection_file is not None:
        value["connectionFile"] = str(Path(connection_file).expanduser().absolute())
    return value
