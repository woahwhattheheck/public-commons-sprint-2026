#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Restore the original parcel receiving operation from its saved worked workspace.

This is preparation for parcel-native-receiving.py under the same maintained
native operation. It restores original bytes and request files; it does not
start a listener, browser, publisher request, or parcel action.
"""
from __future__ import annotations
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

SOURCE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE_ROOT))
from starforge_stac.model import (QgisWorkspace, receive_package, file_digest,
    member, json_bytes, value_sha, retain_bytes)
from starforge_stac.parcels.intake import MANIFEST
from starforge_stac.parcels.state import parcel_state

SCHEMA = "starforge.parcel-operation-restoration.v1"
STAGES = (
    "initial-source-preview", "initial-source-import",
    "initial-review-prepare", "initial-review-preview", "initial-review-save",
    "initial-portfolio-preview", "initial-portfolio-save",
    "full-source-preview", "full-source-import", "cohort-comparison", "cohort-review",
    "additional-review-prepare", "additional-review-preview", "additional-review-save",
    "county-before-correction-preview", "county-before-correction-save",
    "municipal-portfolio-preview", "municipal-portfolio-save",
    "base-year-portfolio-preview", "base-year-portfolio-save",
)

def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)

def request_id(operation_id, stage):
    return "parcel-" + hashlib.sha256((operation_id + "\0primary-" + stage).encode()).hexdigest()[:48]

def original_snapshot(archive):
    with zipfile.ZipFile(archive) as opened:
        record = opened.getinfo("workspace-snapshot.json")
        ensure(record.file_size <= 32 * 1024 * 1024, "The original snapshot exceeds its supported size.")
        return json.loads(opened.read(record))

def prepare(args):
    root = Path(args.output).expanduser().absolute()
    archive = Path(args.archive).expanduser().absolute()
    measured = file_digest(archive)
    ensure(measured["sha256"] == args.expected_archive_sha256, "The selected saved workspace archive differs.")
    saved = original_snapshot(archive)
    ensure(saved["state"]["id"] == args.workspace_id, "Select the original worked workspace identity.")
    requests = {row["requestId"]: row for row in saved.get("analystRequests", [])}
    ensure(len(requests) == len(saved.get("analystRequests", [])), "The saved request journal repeats an identity.")
    original = {}
    destination = root / "workspace"
    for stage in STAGES:
        identity = request_id(args.operation_id, stage)
        row = requests.get(identity)
        ensure(row is not None and row["status"] == "COMPLETED",
               "The saved workspace lacks the completed original stage: " + stage)
        value = row["input"]
        ensure(value["workspaceId"] == args.workspace_id and
               value["workspaceDirectory"] == str(destination) and
               value["actor"] == args.actor and value["action"] == "parcel.command" and
               row["inputSha256"] == value_sha(value),
               "The original request belongs to another actor, workspace, location, or action.")
        original[stage] = row
    initial_id = original["initial-source-import"]["result"]["editionId"]
    full_id = original["full-source-import"]["result"]["editionId"]
    ensure(full_id == args.source_manifest_sha256 and initial_id != full_id,
           "The selected source differs from the original initial/full edition pair.")
    editions = {row["id"]: row for row in parcel_state(saved["state"])["editions"]}
    ensure(initial_id in editions and full_id in editions, "The original source editions are missing.")
    old_subset = original["initial-source-preview"]["input"]["payload"]["payload"]
    ensure(old_subset["expectedManifestSha256"] == initial_id,
           "The saved original preview does not match its imported edition.")
    operation = {"schema": "starforge.parcel-native-receiving.v1",
                 "operationId": args.operation_id, "sourceManifestSha256": full_id,
                 "actor": args.actor, "workspaceDirectory": str(destination)}
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = os.open(root / "operation.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        retained_operation = root / "inputs/operation.json"
        if retained_operation.exists():
            ensure(json.loads(retained_operation.read_bytes()) == operation,
                   "This output directory already belongs to another original operation.")
        received = receive_package(archive, destination, expected_sha256=args.expected_archive_sha256)
        workspace = received["workspace"]
        current = workspace.snapshot()
        ensure(current["state"]["id"] == saved["state"]["id"] and
               current["state"]["revision"] >= saved["state"]["revision"] and
               current["events"][:len(saved["events"])] == saved["events"],
               "The current workspace does not preserve the original saved history.")
        current_requests = {row["requestId"]: row for row in current.get("analystRequests", [])}
        ensure(all(current_requests.get(row["requestId"]) == row for row in saved.get("analystRequests", [])),
               "The current workspace changed an original saved analyst request.")
        # All original raw files, reviews and portfolios were checked by the
        # native receiver. Rehydrate the lost outer input closure from those
        # same original objects, including the initial manifest's actual date.
        initial = editions[initial_id]
        subset = root / "inputs/original-scope"
        subset.mkdir(mode=0o700, parents=True, exist_ok=True)
        for entry in initial["inputs"]:
            record = entry["object"]
            source = member(workspace.root, record["path"])
            file_digest(source, expected=record)
            retain_bytes(subset, entry["path"], source.read_bytes())
        manifest = member(workspace.root, initial["manifest"]["path"])
        file_digest(manifest, expected=initial["manifest"])
        retain_bytes(subset, MANIFEST, manifest.read_bytes())
        ensure(hashlib.sha256((subset / MANIFEST).read_bytes()).hexdigest() == initial_id,
               "The initial original manifest identity changed.")
        retain_bytes(root, "inputs/operation.json", json_bytes(operation))
        retain_bytes(root, "inputs/workspace.json", json_bytes({"workspaceId": args.workspace_id}))
        for stage, row in original.items():
            value = row["input"]
            request = {"requestId": row["requestId"], **{key: copy.deepcopy(value[key])
                       for key in ("action", "payload", "revision", "actor")}}
            retain_bytes(root, "requests/primary-" + stage + ".json", json_bytes(request))
        receipt = {"schema": SCHEMA, "operationId": args.operation_id,
                   "archive": measured, "workspaceId": args.workspace_id,
                   "savedRevision": saved["state"]["revision"], "savedEvents": len(saved["events"]),
                   "savedAnalystRequests": len(saved.get("analystRequests", [])),
                   "restoredStageRequests": {stage: row["requestId"] for stage, row in original.items()},
                   "sourceManifestSha256": full_id, "initialManifestSha256": initial_id,
                   "originalSubsetDirectory": str(subset), "workspaceDirectory": str(destination)}
        retain_bytes(root, "recovery/worked-workspace-" + measured["sha256"] + ".json", json_bytes(receipt))
        return receipt
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        os.close(lock)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--expected-archive-sha256", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--source-manifest-sha256", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--output", required=True,
                        help="The original operation location retained in its saved request inputs.")
    args = parser.parse_args()
    print(json.dumps({"status": "ORIGINAL_OPERATION_PREPARED", **prepare(args)}, separators=(",", ":")))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        raise SystemExit(2)
