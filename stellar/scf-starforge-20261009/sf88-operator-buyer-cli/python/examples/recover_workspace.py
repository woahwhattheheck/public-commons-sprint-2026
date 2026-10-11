#!/usr/bin/env python3
"""Explicit customer recovery stages using the installed maintained Python SDK.

The original engine selects the restore path. This example never removes or moves
an existing workspace and never starts purchases, queues or data acquisition.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path

from stellar_forge_buyer import (
    Buyer, BuyerError, DatasetAcquisition, ObjectBuyer,
    StateError, WorkspaceRecovery, WorkspaceRecoveryError,
)


def parser():
    value = argparse.ArgumentParser(description=__doc__, epilog=(
        "Set the chosen passphrase environment variable privately before launch. "
        "Include every native object/dataset directory inside the selected state root; "
        "their existing paths are retained. See ../RECOVERY.md for stopping writers."))
    value.add_argument("stage", choices=("inspect", "snapshot", "verify", "restore", "reopen"))
    value.add_argument("--checkout", required=True, help="Complete original native source/runtime root")
    value.add_argument("--node", default="node")
    value.add_argument("--operator")
    value.add_argument("--state-root")
    value.add_argument("--app-dir", help="Existing Python application directory, distinct from the Node app")
    value.add_argument("--inbox", action="append", default=[])
    value.add_argument("--include", action="append", default=[])
    value.add_argument("--object-session", action="append", default=[], help="Existing native object session directory")
    value.add_argument("--dataset-session", action="append", default=[], help="Existing native dataset session directory")
    value.add_argument("--out")
    value.add_argument("--bundle")
    value.add_argument("--expect", help="Record SHA-256 selected from the existing trusted backup inventory")
    value.add_argument("--pass-env", default="SF88_BACKUP_PASSPHRASE", help="Passphrase variable NAME, never its value")
    value.add_argument("--python", default="/usr/bin/python3", help="Trusted absolute verification interpreter")
    value.add_argument("--quiesced", action="store_true", help="The actual source writers have already been stopped")
    return value


def existing_directory(value, restored_root=None):
    if not value:
        raise StateError("RECOVERY_EXAMPLE_EXISTING_DIRECTORY_REQUIRED")
    path = Path(value)
    if (not path.is_absolute() or not path.is_dir() or path.is_symlink()
            or path.resolve(strict=True) != path):
        raise StateError("RECOVERY_EXAMPLE_EXISTING_DIRECTORY_REQUIRED")
    if restored_root is not None:
        try:
            path.relative_to(restored_root)
        except ValueError:
            raise StateError("RECOVERY_EXAMPLE_PATH_OUTSIDE_RESTORED_ROOT") from None
    return path


def runtime_options(options):
    return dict(checkout=options.checkout, node=options.node, environment=os.environ)


def buyer(options, restored_root=None):
    # Python Buyer creates its directory, so verify existing state FIRST.
    directory = existing_directory(options.app_dir, restored_root)
    return Buyer(state_dir=directory, **runtime_options(options))


def fields(value, names):
    return {name: value[name] for name in names if name in value}


def reopen(options, restored_root=None):
    original = buyer(options, restored_root)
    history = original.history()
    output = {"applicationDirectory": str(original.state_dir),
              "historySchema": history["schema"],
              "operations": [fields(row, ("intentId", "state", "resultRecoverable", "nativeStatus", "deliveryStatus"))
                             for row in history["operations"]],
              "objects": [], "datasets": []}
    for directory in options.object_session:
        path = existing_directory(directory, restored_root)
        session = ObjectBuyer(**runtime_options(options)).open(path)
        view = session.last_report
        accounting = session.accounting()
        output["objects"].append({"native": fields(view.native,
            ("directory", "sessionId", "status", "bytes", "chunkCount")),
            "accounting": accounting.native})
    for directory in options.dataset_session:
        path = existing_directory(directory, restored_root)
        session = DatasetAcquisition(session=path, **runtime_options(options))
        view = session.inspect()
        output["datasets"].append({"native": fields(view,
            ("directory", "sessionId", "status", "snapshot", "rows", "pages", "finalized"))})
    return output


def result_view(result):
    return {"native": result.native, "process": asdict(result.process),
            "completionReported": result.completion_reported}


def main():
    command = parser()
    options = command.parse_args()
    required = {"inspect": ("operator", "state_root"),
                "snapshot": ("operator", "state_root", "out"),
                "verify": ("bundle", "expect"), "restore": ("bundle", "expect"),
                "reopen": ("app_dir",)}[options.stage]
    for name in required:
        if not getattr(options, name):
            command.error("--" + name.replace("_", "-") + " is required for " + options.stage)
    if (options.object_session or options.dataset_session) and not options.app_dir:
        command.error("--app-dir is required when reopening saved sessions")
    if (options.object_session or options.dataset_session) and options.stage not in ("restore", "reopen"):
        command.error("saved session options are only accepted by restore and reopen")
    completed = None
    try:
        if options.stage == "reopen":
            print(json.dumps({"stage": options.stage, "reopened": reopen(options)}, indent=2))
            return 0
        # Standalone recovery does not initialize the missing original state.
        recovery = WorkspaceRecovery(**runtime_options(options))
        if options.stage in ("inspect", "snapshot"):
            if options.app_dir:
                recovery = buyer(options).workspace_recovery()
            selection = dict(directory=options.operator, state_root=options.state_root,
                             inboxes=options.inbox, include=options.include)
            if options.stage == "inspect":
                completed = recovery.inspect(**selection)
            else:
                completed = recovery.snapshot(**selection, output=options.out,
                    quiesced=options.quiesced, passphrase_env=options.pass_env)
        else:
            archive = dict(bundle=options.bundle, expected_record_sha256=options.expect,
                           python=options.python, passphrase_env=options.pass_env)
            completed = recovery.verify(**archive) if options.stage == "verify" else recovery.restore(**archive)
        output = {"stage": options.stage, **result_view(completed)}
        if options.stage == "restore" and options.app_dir:
            output["reopened"] = reopen(options, Path(completed.state_root))
        print(json.dumps(output, indent=2))
        return 0
    except (BuyerError, OSError, ValueError) as error:
        result = error.result if isinstance(error, WorkspaceRecoveryError) else completed
        # Keep original completion visible if a later application read fails.
        print(json.dumps({"error": getattr(error, "code", "RECOVERY_EXAMPLE_FAILED"),
                          "recovery": result_view(result) if result is not None else None}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
