#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Continue reviewed migration editions through native maps and independent receiving."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

_COMPONENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_COMPONENT.parent))
from migration.receiving import (
    _native_operation, build_projects, export_handover, inspect_handover, receive, reopen_handover,
)
from migration.workspace import Workspace
from starforge_stac.model import (
    directory, file_digest, json_bytes, read_json, require, retain_bytes, value_sha,
)


def _keep(root, name, value):
    path = root / name
    if path.exists():
        original, _ = read_json(path)
        require(original == value, "JOURNEY_RESULT_CHANGED",
                "Continue the original complete receiving operation.", path=name)
        return original
    retain_bytes(root, name, json_bytes(value))
    return value


def _progress(value):
    if value.get("phase") in ("migration-project", "native-reopen", "file-complete"):
        print(json.dumps(value, ensure_ascii=False), flush=True)


@_native_operation
def reopen_received(workspace_path, output_file):
    """Called from the received source tree by a separate selected-QGIS process."""
    workspace = Workspace(directory(workspace_path))
    import migration.receiving as receiving_module
    import migration.workspace as workspace_module
    import starforge_stac.model as model_module
    from starforge_stac.qgis_project import native_version
    software = workspace.root / "software"
    source_files = {}
    for label, module in (("migration.receiving", receiving_module),
                          ("migration.workspace", workspace_module),
                          ("starforge_stac.model", model_module)):
        path = Path(module.__file__).resolve()
        require(path.is_relative_to(software.resolve()), "RECEIVED_SOFTWARE_SOURCE",
                "Run independent receiving with this archive's complete original application source.", module=label)
        source_files[label] = {"path": path.relative_to(workspace.root).as_posix(), **file_digest(path)}
    result = {
        "schema": "starforge.migration-independent-reopen.v1",
        "workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"],
        "snapshotSha256": value_sha(workspace.snapshot()),
        "sourceFiles": source_files, "native": native_version(),
        "reopened": reopen_handover(workspace, progress=_progress),
    }
    output = Path(output_file).expanduser().absolute()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.exists():
        old, _ = read_json(output)
        require(old["workspaceId"] == result["workspaceId"]
                and old["snapshotSha256"] == result["snapshotSha256"]
                and old["sourceFiles"] == result["sourceFiles"],
                "RECEIVED_REOPEN_CHANGED", "Retain the original independent receiving result.")
        result = old
    else:
        retain_bytes(output.parent, output.name, json_bytes(result))
    print(json.dumps({"independentReopen": "complete", "workspaceId": result["workspaceId"],
                      "projects": len(result["reopened"]["projects"]), "result": str(output)}), flush=True)
    return result


def _independent_receiver(workspace, output):
    software = workspace.root / "software"
    candidates = [
        software / "migration" / "examples" / "receiving_journey.py",
        software / "stac" / "migration" / "examples" / "receiving_journey.py",
    ]
    present = [path for path in candidates if path.is_file() and not path.is_symlink()]
    require(len(present) == 1, "COMPLETE_MIGRATION_SOFTWARE",
            "The handover must include one complete migration application and this original receiving entrypoint.")
    entry = present[0]
    if output.exists():
        original, _ = read_json(output)
        require(original["workspaceId"] == workspace.read()["id"]
                and original["snapshotSha256"] == value_sha(workspace.snapshot()),
                "RECEIVED_REOPEN_CHANGED", "Keep the original independent receiving workspace.")
        for record in original["sourceFiles"].values():
            file_digest(workspace.root / record["path"], expected=record)
        return original
    environment = dict(os.environ)
    environment.setdefault("QT_QPA_PLATFORM", "offscreen")
    # The child resolves application modules from its received entrypoint.
    # The selected QGIS Python retains its original native provider installation.
    with output.with_suffix(".stdout.log").open("ab") as log:
        child = subprocess.run(
            [sys.executable, str(entry), "--reopen-received", str(workspace.root), "--output", str(output)],
            cwd=workspace.root, env=environment, stdout=log, stderr=subprocess.STDOUT, check=False,
        )
    require(child.returncode == 0 and output.is_file(), "INDEPENDENT_RECEIVING",
            "The selected QGIS process did not complete the original independent reopen.",
            returncode=child.returncode, log=str(output.with_suffix(".stdout.log")))
    return read_json(output)[0]


@_native_operation
def perform(config_file):
    config, _ = read_json(config_file)
    require(isinstance(config, dict) and isinstance(config.get("operationId"), str)
            and config["operationId"] and isinstance(config.get("editions"), list) and config["editions"],
            "JOURNEY_CONFIGURATION", "Select the original migration workspace and complete reviewed edition sequence.")
    root = Path(config["outputRoot"]).expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root = directory(root)
    workspace = Workspace(directory(config["workspace"]))
    require(not root.is_relative_to(workspace.root), "JOURNEY_OUTPUT",
            "Keep complete receiving outputs outside the active migration workspace.")
    _keep(root, "operation-input.json", {"schema": "starforge.migration-receiving-journey.v1", "config": config})
    actor = config.get("actor", "Migration receiving operator")
    final_path = root / "result.json"
    if final_path.exists():
        result, _ = read_json(final_path)
        require(result["operationId"] == config["operationId"], "JOURNEY_IDENTITY",
                "Continue the original receiving operation.")
        file_digest(root / "complete-migration.zip", expected=result["archive"])
        receiver = receive(root / "complete-migration.zip", root / "received-workspace",
                           expected_sha256=result["archive"]["sha256"], native_reopen="required")
        require(receiver["workspaceId"] == result["workspaceId"], "JOURNEY_IDENTITY",
                "Keep the original received workspace.")
        print(json.dumps({"operationId": config["operationId"], "complete": True,
                          "replayed": True, "result": str(final_path)}), flush=True)
        return result

    requests = set()
    source_ids, built_projects = [], []
    for index, selected in enumerate(config["editions"], 1):
        require(isinstance(selected, dict) and isinstance(selected.get("editionId"), str),
                "JOURNEY_EDITION", "Use the original retained migration edition IDs.")
        request_id = selected.get("requestId") or "migration-journey-" + value_sha({
            "operationId": config["operationId"], "editionId": selected["editionId"], "position": index,
        })
        require(request_id not in requests, "JOURNEY_REQUEST", "Use a distinct stable request for each edition build.")
        requests.add(request_id)
        action_name = "actions/" + value_sha(request_id) + ".json"
        action_path = root / action_name
        if action_path.exists():
            action, _ = read_json(action_path)
            require(action["request_id"] == request_id and action["actor"] == actor
                    and action["edition_id"] == selected["editionId"]
                    and ("expectedRevision" not in selected or
                         action["expected_revision"] == selected["expectedRevision"]),
                    "JOURNEY_ACTION_CHANGED", "Continue the same reviewed native build input.")
        else:
            action = {
                "edition_id": selected["editionId"], "request_id": request_id, "actor": actor,
                "expected_revision": selected.get("expectedRevision", workspace.read()["revision"]),
            }
            _keep(root, action_name, action)
        result = build_projects(workspace, progress=_progress, **action)
        original = workspace.operation(request_id)
        replayed = build_projects(workspace, progress=_progress, **action)
        require(workspace.operation(request_id) == original and replayed["replayed"],
                "JOURNEY_BUILD_RETRY", "The completed original project build must retain the same journal entry.")
        _keep(root, "builds/" + value_sha(request_id) + ".json", original)
        source_ids.append(result["projectBuild"]["sourceId"])
        built_projects.extend(result["projectBuild"]["projects"])

    comparisons = []
    for index in range(1, len(source_ids)):
        if source_ids[index - 1] == source_ids[index]:
            continue
        comparison = workspace.compare(source_ids[index - 1], source_ids[index])
        name = "comparisons/" + str(index) + ".json"
        _keep(root, name, comparison)
        comparisons.append({"path": name, **file_digest(root / name)})

    reopened = reopen_handover(workspace, progress=_progress)
    export_action = root / "export-input.json"
    if export_action.exists():
        selected_export, _ = read_json(export_action)
    else:
        selected_export = {"workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"]}
        _keep(root, "export-input.json", selected_export)
    require(selected_export["workspaceId"] == workspace.read()["id"], "JOURNEY_EXPORT_CHANGED",
            "Keep the original export workspace.")
    archive = export_handover(workspace, root / "complete-migration.zip",
                              expected_revision=selected_export["revision"], progress=_progress)
    _keep(root, "archive.json", archive)
    inspected = inspect_handover(archive["path"], expected_sha256=archive["sha256"], progress=_progress)
    incoming = receive(archive["path"], root / "received-workspace",
                       expected_sha256=archive["sha256"], native_reopen="required", progress=_progress)
    again = receive(archive["path"], root / "received-workspace",
                    expected_sha256=archive["sha256"], native_reopen="required", progress=_progress)
    receiver = incoming["workspace"]
    require(again["replayed"] and value_sha(receiver.snapshot()) == inspected["snapshotSha256"],
            "JOURNEY_SNAPSHOT", "The independent receiving must retain the exact full original snapshot.")
    independent = _independent_receiver(receiver, root / "independent-reopen.json")
    onward = export_handover(receiver, root / "onward-migration.zip",
                             expected_revision=receiver.read()["revision"], progress=_progress)
    _keep(root, "onward-archive.json", onward)
    onward_received = receive(onward["path"], root / "onward-workspace",
                              expected_sha256=onward["sha256"], native_reopen="required", progress=_progress)
    require(onward_received["workspace"].snapshot() == receiver.snapshot(), "JOURNEY_ONWARD_SNAPSHOT",
            "The complete onward handover must retain the original migration and project history.")
    onward_independent = _independent_receiver(onward_received["workspace"], root / "onward-independent-reopen.json")
    result = {
        "schema": "starforge.migration-receiving-result.v1", "operationId": config["operationId"],
        "workspaceId": inspected["workspaceId"], "revision": inspected["revision"],
        "editionIds": [row["editionId"] for row in config["editions"]], "sourceIds": source_ids,
        "builtProjects": built_projects, "comparisons": comparisons, "archive": archive,
        "snapshotSha256": inspected["snapshotSha256"], "files": inspected["fileCount"],
        "receiving": incoming["receipt"], "reopened": reopened, "independent": independent,
        "onwardArchive": onward, "onwardReceiving": onward_received["receipt"],
        "onwardIndependent": onward_independent,
    }
    _keep(root, "result.json", result)
    print(json.dumps({"operationId": config["operationId"], "complete": True,
                      "result": str(final_path), "workspaceId": result["workspaceId"],
                      "savedProjects": len(inspected["projects"])}), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--config")
    action.add_argument("--reopen-received")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.reopen_received:
        require(args.output is not None, "RECEIVED_RESULT_PATH", "Choose the original independent result file.")
        return reopen_received(args.reopen_received, args.output)
    return perform(args.config)


if __name__ == "__main__":
    main()
