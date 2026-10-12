"""Managed startup identity for the original SF47 workspace and Python process."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from datetime import datetime, timezone
from uuid import uuid4

from model import Problem, canonical

SCHEMA = "stellar-forge.sf47.workspace-launch.v1"
SELECTION_SCHEMA = "stellar-forge.sf47.workspace-selection.v1"
SOURCE = Path(__file__).resolve().parent
BOOT_FILES = ("../budget.py", "cli.py", "server.py", "model.py",
              "launcher.mjs", "launch.mjs", "managed_launch.py")
PRIVATE_NAME = "managed-launch.json"


def file_sha(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise Problem("Select a bounded original source file.", 422, "GRANT_SOURCE_FILE_INVALID")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if (len(raw) != before.st_size or before.st_size != after.st_size or
                before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
            raise Problem("The selected source changed during reading.", 409, "GRANT_SOURCE_FILE_CHANGED")
        return hashlib.sha256(raw).hexdigest()


def selection(workspace_path, source_path, source_directory=None):
    selected_source = Path(source_directory).expanduser().resolve() if source_directory is not None else SOURCE
    workspace = Path(workspace_path).expanduser().resolve()
    scenario = Path(source_path).expanduser().resolve()
    executable = str(Path(sys.executable).absolute())
    selected = {
        "schema": SELECTION_SCHEMA,
        "workspaceDirectory": str(workspace),
        "sourceDirectory": str(selected_source),
        "scenarioFile": str(scenario),
        "scenarioSha256": file_sha(scenario, 32 * 1024 * 1024),
        "pythonExecutable": executable,
        "pythonRealPath": str(Path(executable).resolve()),
        "sourceSha256": {
            name: file_sha(selected_source / name, 1024 * 1024)
            for name in BOOT_FILES
        },
    }
    return selected, hashlib.sha256(canonical(selected).encode("utf-8")).hexdigest()


def require_selection(workspace_path, source_path, expected_sha, access_file=None, source_directory=None):
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
        raise Problem("Review the original managed launch before starting it.", 409, "GRANT_LAUNCH_REVIEW_REQUIRED")
    if source_directory is None or not Path(source_directory).is_absolute():
        raise Problem("Select the reviewed original grant workspace source.", 409, "GRANT_SOURCE_SELECTION_CHANGED")
    selected, digest = selection(workspace_path, source_path, source_directory)
    if digest != expected_sha:
        raise Problem("The workspace, scenario, Python or installed source changed. Review this launch again.",
                      409, "GRANT_LAUNCH_SELECTION_CHANGED")
    execution = {"sourceDirectory": str(SOURCE),
                 "sourceSha256": {name: file_sha(SOURCE / name, 1024 * 1024) for name in BOOT_FILES}}
    if execution["sourceSha256"] != selected["sourceSha256"]:
        raise Problem("The managed release differs from the reviewed original grant source.", 409,
                      "GRANT_EXECUTED_SOURCE_CHANGED")
    root = Path(selected["workspaceDirectory"])
    if access_file is not None and Path(access_file).expanduser().resolve() != root / "open-workspace.html":
        raise Problem("Managed opening uses the original private workspace access file.", 422,
                      "GRANT_MANAGED_ACCESS_FILE_INVALID")
    return selected, digest, execution


def public_launch(record):
    return {key: value for key, value in record.items() if key != "accessToken"}


def retain_launch(server, selected, digest, execution, writer):
    root = Path(selected["workspaceDirectory"])
    if server.workspace.root != root:
        raise Problem("The original workspace did not match its launch review.", 409, "GRANT_LAUNCH_WORKSPACE_CHANGED")
    record = {
        "schema": SCHEMA,
        "state": "LISTENING",
        "instanceId": str(uuid4()),
        "pid": os.getpid(),
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "selection": selected,
        "selectionSha256": digest,
        "execution": execution,
        "url": server.origin,
        "accessFile": str(server.access_file),
        "privateLaunch": str(root / PRIVATE_NAME),
        "accessToken": server.token,
    }
    writer(root / PRIVATE_NAME, (canonical(record) + "\n").encode("utf-8"))
    server.managed_launch = record
    return public_launch(record)


def retire_launch(server, writer):
    record = getattr(server, "managed_launch", None)
    if record is None:
        return
    record = {**record, "state": "STOPPED", "stoppedAt": datetime.now(timezone.utc).isoformat()}
    writer(record["privateLaunch"], (canonical(record) + "\n").encode("utf-8"))
    server.managed_launch = record
