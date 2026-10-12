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
from migration.native import files as native_files, model as original_model, qgis_project as original_qgis

directory, file_digest, json_bytes = original_model.directory, original_model.file_digest, original_model.json_bytes
read_json, require = original_model.read_json, original_model.require
retain_bytes, value_sha = original_model.retain_bytes, original_model.value_sha


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


def _same_history(before, current):
    """Accept only the same saved workspace or its original journal continuation."""
    require(before["schema"] == current["schema"]
            and before["state"]["id"] == current["state"]["id"]
            and current["state"]["revision"] >= before["state"]["revision"],
            "JOURNEY_WORKSPACE_CHANGED", "Use the same original migration workspace and history.")
    require(current["events"][:len(before["events"])] == before["events"],
            "JOURNEY_HISTORY_CHANGED", "The retained workspace event prefix changed.")
    current_requests = {row["requestId"]: row for row in current["requests"]}
    require(len(current_requests) == len(current["requests"])
            and all(current_requests.get(row["requestId"]) == row for row in before["requests"]),
            "JOURNEY_REQUEST_HISTORY_CHANGED", "Preserve every original committed request and result.")
    if before["state"]["revision"] == current["state"]["revision"]:
        require(value_sha(before) == value_sha(current), "JOURNEY_SNAPSHOT_CHANGED",
                "The selected original workspace snapshot changed without a journal revision.")
    for name in ("sources", "projects"):
        retained = {row["id"]: row for row in current["state"][name]}
        require(all(retained.get(row["id"]) == row for row in before["state"][name]),
                "JOURNEY_SOURCE_CHANGED", "Preserve the original retained sources and projects.", collection=name)
    old_migration = before["state"].get("migration", {})
    migration = current["state"].get("migration", {})
    for name in ("captures", "plans", "editions", "projectDeliveries", "reviews", "inputs", "software"):
        retained = {row["id"]: row for row in migration.get(name, [])}
        require(all(retained.get(row["id"]) == row for row in old_migration.get(name, [])),
                "JOURNEY_MIGRATION_CHANGED", "Preserve the original migration records.", collection=name)


def _bind_workspace(root, workspace, config, remap):
    current = workspace.snapshot()
    identity = {
        "schema": "starforge.migration-receiving-workspace.v1",
        "operationId": config["operationId"], "configSha256": value_sha(config),
        "workspaceId": current["state"]["id"],
        "editions": [{"editionId": row["editionId"],
                      "documentSha256": native_files.digest(workspace.document("edition", row["editionId"]))}
                     for row in config["editions"]],
    }
    binding_path = root / "workspace-input.json"
    snapshot_path = root / "workspace-input-snapshot.json"
    if binding_path.exists():
        binding, _ = read_json(binding_path)
        require(all(binding.get(key) == value for key, value in identity.items()),
                "JOURNEY_WORKSPACE_BINDING", "Retain the original operation, workspace and edition documents.")
        require(binding["snapshotFile"]["path"] == snapshot_path.name,
                "JOURNEY_WORKSPACE_BINDING", "Use the original retained workspace snapshot.")
        file_digest(snapshot_path, expected=binding["snapshotFile"])
        original, _ = read_json(snapshot_path)
        require(value_sha(original) == binding["snapshotSha256"],
                "JOURNEY_WORKSPACE_BINDING", "The retained source snapshot identity changed.")
    else:
        original = read_json(snapshot_path)[0] if snapshot_path.exists() else current
        _same_history(original, current)
        binding = {**identity, "snapshotSha256": value_sha(original)}
        if remap is not None:
            require(remap["expectedWorkspaceId"] == binding["workspaceId"]
                    and remap["expectedSnapshotSha256"] == binding["snapshotSha256"],
                    "JOURNEY_HOST_BINDING", "Match this move to the selected original workspace snapshot.")
        _keep(root, snapshot_path.name, original)
        binding["snapshotFile"] = {"path": snapshot_path.name, **file_digest(snapshot_path)}
        _keep(root, binding_path.name, binding)
    _same_history(original, current)
    if remap is not None:
        require(remap["expectedWorkspaceId"] == binding["workspaceId"]
                and remap["expectedSnapshotSha256"] == binding["snapshotSha256"],
                "JOURNEY_HOST_BINDING", "Match this move to the operation's retained source snapshot.")
        workspace.verify_migration()
        host = {
            "schema": "starforge.migration-receiving-host-binding.v1",
            "operationId": config["operationId"], "configSha256": binding["configSha256"],
            "workspaceId": binding["workspaceId"], "snapshotSha256": binding["snapshotSha256"],
            "workspace": str(workspace.root), "outputRoot": str(root),
        }
        _keep(root, "host-bindings/" + value_sha(host) + ".json", host)
    return binding


def _open_journey(config, remap_file):
    remap = None
    if remap_file is not None:
        remap, _ = read_json(remap_file)
        fields = {"schema", "operationId", "expectedWorkspaceId", "expectedSnapshotSha256",
                  "workspace", "outputRoot"}
        require(isinstance(remap, dict) and set(remap) == fields
                and remap["schema"] == "starforge.migration-receiving-host.v1"
                and remap["operationId"] == config["operationId"]
                and all(isinstance(remap[name], str) and remap[name] for name in fields),
                "JOURNEY_HOST_CONFIGURATION", "Select explicit host paths for this original operation.")
        require(len(remap["expectedSnapshotSha256"]) == 64
                and all(char in "0123456789abcdef" for char in remap["expectedSnapshotSha256"]),
                "JOURNEY_HOST_CONFIGURATION", "Use the retained snapshot's exact SHA-256.")
    locations = remap if remap is not None else config
    require(all(isinstance(locations.get(name), str) and locations[name] for name in ("workspace", "outputRoot")),
            "JOURNEY_CONFIGURATION", "Select the existing workspace and original receiving output directory.")
    root = Path(locations["outputRoot"]).expanduser().absolute()
    if remap is not None:
        require(root.is_dir() and (root / "operation-input.json").is_file(),
                "JOURNEY_ORIGINAL_OUTPUT", "Move the complete original operation directory before continuing.")
    else:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root = directory(root)
    workspace = Workspace(directory(locations["workspace"]))
    require(not root.is_relative_to(workspace.root), "JOURNEY_OUTPUT",
            "Keep complete receiving outputs outside the active migration workspace.")
    _keep(root, "operation-input.json", {"schema": "starforge.migration-receiving-journey.v1", "config": config})
    _bind_workspace(root, workspace, config, remap)
    return root, workspace


def _archive(root, name, workspace, filename, revision):
    """Keep the original receipt; the current archive location is host-specific."""
    target = root / filename
    receipt_path = root / name
    retained = read_json(receipt_path)[0] if receipt_path.exists() else None
    if retained is not None:
        require(target.is_file(), "JOURNEY_ARCHIVE_MISSING",
                "Move the original completed archive with its saved receipt.", file=filename)
    actual = export_handover(
        workspace, target, expected_revision=revision,
        expected_sha256=retained["sha256"] if retained is not None else None, progress=_progress,
    )
    if retained is not None:
        fields = ("bytes", "sha256", "manifestSha256", "workspaceId", "revision", "fileCount", "totalDecodedBytes")
        require(all(actual.get(key) == retained.get(key) for key in fields),
                "JOURNEY_ARCHIVE_CHANGED", "Preserve the complete original archive and its receipt.", file=filename)
        return retained
    return _keep(root, name, actual)


def _current_locations(root, workspace):
    return {
        "workspace": str(workspace.root), "outputRoot": str(root),
        "result": str(root / "result.json"),
        "archive": str(root / "complete-migration.zip"),
        "receivedWorkspace": str(root / "received-workspace"),
        "onwardArchive": str(root / "onward-migration.zip"),
        "onwardWorkspace": str(root / "onward-workspace"),
    }


def _software_candidates(workspace):
    """Resolve the complete application only through retained software metadata."""
    rows = workspace.read().get("migration", {}).get("software", [])
    require(isinstance(rows, list) and rows, "COMPLETE_MIGRATION_SOFTWARE",
            "Retain the complete migration application in the original workspace software records.")
    candidates, identities = [], set()
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get("id"), str) and row["id"]
                and row["id"] not in identities and isinstance(row.get("files"), list),
                "MIGRATION_SOFTWARE_RECORD", "Keep each original software record and complete file inventory.")
        identities.add(row["id"])
        prefix = original_model.relative_name(row.get("path"))
        require(prefix.startswith("migration/software/"), "MIGRATION_SOFTWARE_PATH",
                "Use the declared original migration software location.")
        records = {}
        for item in row["files"]:
            record = original_model.descriptor(item)
            require(record["path"].startswith(prefix + "/") and record["path"] not in records,
                    "MIGRATION_SOFTWARE_CLOSURE", "Keep the selected software's complete original file closure.")
            records[record["path"]] = record
        entries = [record for name, record in records.items()
                   if name.endswith("/stac/migration/examples/receiving_journey.py")]
        require(len(entries) == 1, "COMPLETE_MIGRATION_SOFTWARE",
                "Each complete application needs its own original receiving entrypoint.", softwareId=row["id"])
        entry = entries[0]
        stac = entry["path"].removesuffix("/migration/examples/receiving_journey.py")
        required = ("migration/receiving.py", "migration/workspace.py", "migration/native.py",
                    "qgis/starforge_stac/__init__.py", "qgis/starforge_stac/model.py",
                    "qgis/starforge_stac/qgis_project.py", "vector/__init__.py", "vector/common.py")
        require(all(stac + "/" + name in records for name in required),
                "COMPLETE_MIGRATION_SOFTWARE", "Include the original application and its paired native engines.",
                softwareId=row["id"])
        candidates.append({"id": row["id"], "recordSha256": native_files.digest(row),
                           "path": prefix, "stac": stac, "entrypoint": entry, "records": records})
    return candidates


def _matches_running_source(candidate):
    """Choose a retained edition only when its complete source matches this installation."""
    current = _COMPONENT.parent
    selected = candidate["stac"] + "/"
    for name, record in candidate["records"].items():
        if not name.startswith(selected):
            continue
        try:
            path = original_model.member(current, name[len(selected):])
            file_digest(path, expected=record)
        except (OSError, ValueError):
            return False
    return True


def _select_software(workspace, software_id=None):
    candidates = _software_candidates(workspace)
    if software_id is not None:
        require(isinstance(software_id, str) and software_id, "MIGRATION_SOFTWARE_SELECTION",
                "Use an original retained software ID.")
        selected = [row for row in candidates if row["id"] == software_id]
    elif len(candidates) == 1:
        selected = candidates
    else:
        selected = [row for row in candidates if _matches_running_source(row)]
    require(len(selected) == 1, "MIGRATION_SOFTWARE_SELECTION",
            "Select the original application edition explicitly when several retained editions are available.",
            softwareIds=[row["id"] for row in candidates])
    choice = selected[0]
    for record in choice["records"].values():
        file_digest(original_model.member(workspace.root, record["path"]), expected=record)
    return choice


def _software_binding(choice):
    return {name: choice[name] for name in ("id", "recordSha256", "path", "stac", "entrypoint")}


def _loaded_received_sources(workspace, choice):
    """All loaded product modules must be declared members of this received application."""
    import migration.receiving as receiving_module
    import migration.workspace as workspace_module
    import migration.native as native_module
    prefixes = {"migration", original_model.__package__, native_files.__package__}
    modules = {"migration.receiving": receiving_module, "migration.workspace": workspace_module,
               "migration.native": native_module, "starforge_stac.model": original_model,
               "starforge_stac.qgis_project": original_qgis, "vector.common": native_files}
    for name, module in sorted(sys.modules.items()):
        if module is not None and getattr(module, "__file__", None) and any(
                name == prefix or name.startswith(prefix + ".") for prefix in prefixes):
            modules[name] = module
    paths = {label: Path(module.__file__).resolve() for label, module in modules.items()}
    paths["receiving_entrypoint"] = Path(__file__).resolve()
    records = {}
    for label, path in sorted(paths.items()):
        require(path.is_relative_to(workspace.root), "RECEIVED_SOFTWARE_SOURCE",
                "Run the complete application from this independently received workspace.", module=label)
        relative = path.relative_to(workspace.root).as_posix()
        record = choice["records"].get(relative)
        require(record is not None, "RECEIVED_SOFTWARE_SOURCE",
                "The loaded original module must belong to the selected software edition.", module=label)
        file_digest(original_model.member(workspace.root, relative), expected=record)
        records[label] = record
    require(records["receiving_entrypoint"] == choice["entrypoint"], "RECEIVED_SOFTWARE_SOURCE",
            "Run this software edition's declared original receiving entrypoint.")
    return records


@_native_operation
def reopen_received(workspace_path, output_file, software_id=None):
    """Called from the received source tree by a separate selected-QGIS process."""
    workspace = Workspace(directory(workspace_path))
    choice = _select_software(workspace, software_id)
    reopened = reopen_handover(workspace, progress=_progress)
    source_files = _loaded_received_sources(workspace, choice)
    result = {
        "schema": "starforge.migration-independent-reopen.v1",
        "workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"],
        "snapshotSha256": value_sha(workspace.snapshot()),
        "software": _software_binding(choice), "sourceFiles": source_files,
        "native": original_qgis.native_version(), "reopened": reopened,
    }
    output = Path(output_file).expanduser().absolute()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.exists():
        old, _ = read_json(output)
        require(old["workspaceId"] == result["workspaceId"]
                and old["snapshotSha256"] == result["snapshotSha256"]
                and old.get("software") == result["software"]
                and old["sourceFiles"] == result["sourceFiles"],
                "RECEIVED_REOPEN_CHANGED", "Retain the original independent receiving result.")
        result = old
    else:
        retain_bytes(output.parent, output.name, json_bytes(result))
    print(json.dumps({"independentReopen": "complete", "workspaceId": result["workspaceId"],
                      "softwareId": choice["id"], "projects": len(result["reopened"]["projects"]),
                      "result": str(output)}), flush=True)
    return result


def _independent_receiver(workspace, output, software_id=None):
    choice = _select_software(workspace, software_id)
    entry = original_model.member(workspace.root, choice["entrypoint"]["path"])
    if output.exists():
        original, _ = read_json(output)
        require(original["workspaceId"] == workspace.read()["id"]
                and original["snapshotSha256"] == value_sha(workspace.snapshot())
                and original.get("software") == _software_binding(choice),
                "RECEIVED_REOPEN_CHANGED", "Keep the original independent workspace and application edition.")
        for record in original["sourceFiles"].values():
            require(choice["records"].get(record["path"]) == record, "RECEIVED_SOFTWARE_SOURCE",
                    "Retain the original complete application module binding.")
            file_digest(original_model.member(workspace.root, record["path"]), expected=record)
        return original
    environment = dict(os.environ)
    environment.setdefault("QT_QPA_PLATFORM", "offscreen")
    # The child resolves all product modules through its own received application.
    # The selected QGIS Python retains its original native provider installation.
    with output.with_suffix(".stdout.log").open("ab") as log:
        child = subprocess.run(
            [sys.executable, str(entry), "--reopen-received", str(workspace.root),
             "--software-id", choice["id"], "--output", str(output)],
            cwd=workspace.root, env=environment, stdout=log, stderr=subprocess.STDOUT, check=False,
        )
    require(child.returncode == 0 and output.is_file(), "INDEPENDENT_RECEIVING",
            "The selected QGIS process did not complete the original independent reopen.",
            returncode=child.returncode, log=str(output.with_suffix(".stdout.log")))
    original, _ = read_json(output)
    require(original.get("software") == _software_binding(choice), "RECEIVED_SOFTWARE_SOURCE",
            "The independent native process must retain the selected original application edition.")
    return original


@_native_operation
def perform(config_file, remap=None):
    config, _ = read_json(config_file)
    require(isinstance(config, dict) and isinstance(config.get("operationId"), str)
            and config["operationId"] and isinstance(config.get("editions"), list) and config["editions"],
            "JOURNEY_CONFIGURATION", "Select the original migration workspace and complete reviewed edition sequence.")
    require(all(isinstance(row, dict) and isinstance(row.get("editionId"), str) and row["editionId"]
                for row in config["editions"]), "JOURNEY_EDITION",
            "Use the complete original retained migration edition sequence.")
    root, workspace = _open_journey(config, remap)
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
        file_digest(root / "onward-migration.zip", expected=result["onwardArchive"])
        onward = receive(root / "onward-migration.zip", root / "onward-workspace",
                         expected_sha256=result["onwardArchive"]["sha256"], native_reopen="required")
        require(onward["workspaceId"] == result["workspaceId"], "JOURNEY_IDENTITY",
                "Keep the original onward receiving workspace.")
        locations = _current_locations(root, workspace)
        print(json.dumps({"operationId": config["operationId"], "complete": True,
                          "replayed": True, "result": str(final_path), "locations": locations}), flush=True)
        return {**result, "locations": locations}

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
    archive = _archive(root, "archive.json", workspace, "complete-migration.zip", selected_export["revision"])
    archive_path = root / "complete-migration.zip"
    inspected = inspect_handover(archive_path, expected_sha256=archive["sha256"], progress=_progress)
    incoming = receive(archive_path, root / "received-workspace",
                       expected_sha256=archive["sha256"], native_reopen="required", progress=_progress)
    again = receive(archive_path, root / "received-workspace",
                    expected_sha256=archive["sha256"], native_reopen="required", progress=_progress)
    receiver = incoming["workspace"]
    require(again["replayed"] and value_sha(receiver.snapshot()) == inspected["snapshotSha256"],
            "JOURNEY_SNAPSHOT", "The independent receiving must retain the exact full original snapshot.")
    independent = _independent_receiver(receiver, root / "independent-reopen.json", config.get("softwareId"))
    onward = _archive(root, "onward-archive.json", receiver, "onward-migration.zip", receiver.read()["revision"])
    onward_received = receive(root / "onward-migration.zip", root / "onward-workspace",
                              expected_sha256=onward["sha256"], native_reopen="required", progress=_progress)
    require(onward_received["workspace"].snapshot() == receiver.snapshot(), "JOURNEY_ONWARD_SNAPSHOT",
            "The complete onward handover must retain the original migration and project history.")
    onward_independent = _independent_receiver(onward_received["workspace"], root / "onward-independent-reopen.json",
                                               independent["software"]["id"])
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
                      "savedProjects": len(inspected["projects"]),
                      "locations": _current_locations(root, workspace)}), flush=True)
    return {**result, "locations": _current_locations(root, workspace)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--config")
    action.add_argument("--reopen-received")
    parser.add_argument("--output")
    parser.add_argument("--software-id", help="Original retained application edition for an independent reopen.")
    parser.add_argument("--remap", help="Explicit host paths bound to the original operation and workspace snapshot.")
    args = parser.parse_args()
    if args.reopen_received:
        require(args.remap is None, "JOURNEY_HOST_CONFIGURATION", "Use --remap only with the original --config.")
        require(args.output is not None, "RECEIVED_RESULT_PATH", "Choose the original independent result file.")
        return reopen_received(args.reopen_received, args.output, args.software_id)
    require(args.software_id is None, "MIGRATION_SOFTWARE_SELECTION", "Keep the softwareId in the original journey config.")
    return perform(args.config, remap=args.remap)


if __name__ == "__main__":
    main()
