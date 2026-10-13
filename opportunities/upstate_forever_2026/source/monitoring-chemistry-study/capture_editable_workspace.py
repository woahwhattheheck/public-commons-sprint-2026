#!/usr/bin/env python3
"""Capture and resume the complete selected native study without scheduling analyses."""
from pathlib import Path
import argparse
import fcntl
import importlib.util
import json
import os
import stat
import sys
import zipfile

SCHEMA = "upstate.completed-study-receiving/v1"
SELECTION = {"include_intermediates": True, "include_deliveries": True}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_opener():
    path = Path(__file__).with_name("open_completed_study.py").resolve(strict=True)
    spec = importlib.util.spec_from_file_location("completed_study_opener", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verified_archive(path, workspace, selected, previous, portable):
    """Verify one opened archive edition and its exact selected native members."""
    from model.common import digest
    with path.open("rb") as stream:
        before = portable._archive_identity(stream)
        with zipfile.ZipFile(stream) as archive:
            manifest = portable._inspect_archive(archive, verify=True)
        checksum = portable._archive_digest(stream, before)
        current = path.lstat()
        require(stat.S_ISREG(current.st_mode)
                and (current.st_dev, current.st_ino, current.st_size,
                     current.st_mtime_ns, current.st_ctime_ns) == before,
                "The complete archive pathname changed during verification")
    require(manifest["project"] == selected["retained"]["project"] == workspace.project,
            "Completed archive belongs to another selected scientific project")
    require(manifest["selection"] == SELECTION,
            "Retain the original full Workspace archive including intermediates and deliveries")
    expected = {"workspace/" + name: item for name, item in selected["files"].items()}
    expected.update({"application/" + item["path"]: item
                     for item in selected["producers"].values()})
    for name, item in expected.items():
        actual = manifest["members"].get(name)
        require(actual is not None and all(actual[key] == item[key] for key in ("bytes", "sha256")),
                "Archive does not contain the selected original scientific member: " + name)
    record = {"path": str(path), "bytes": before[2], "sha256": checksum,
              "members": len(manifest["members"]), "selection": manifest["selection"],
              "project_id": manifest["project"]["id"], "manifest_sha256": digest(manifest)}
    if previous is not None:
        # The original native backup receipt has additional metadata. Its actual
        # archive identity remains authoritative when upgrading the helper.
        require(all(previous.get(key) == record[key] for key in (
            "bytes", "sha256", "members", "selection", "project_id")),
            "Completed archive differs from its retained native backup receipt")
        require(Path(previous["path"]).resolve() == path,
                "Retained backup receipt names another archive")
        if "manifest_sha256" in previous:
            require(previous["manifest_sha256"] == record["manifest_sha256"],
                    "Retained complete archive manifest changed")
    return manifest, record


def capture(args):
    application = args.application.resolve(strict=True)
    root = args.workspace.resolve(strict=True)
    reports = args.reports.resolve(strict=True)
    comparison = args.comparison.resolve(strict=True)
    output, archive, destination = (p.resolve() for p in (
        args.output, args.archive, args.receive_into))
    for selected in (output, archive, destination):
        require(not selected.is_relative_to(application) and not selected.is_relative_to(root),
                "Keep receiving outputs outside the application and scientific Workspace")
    require(not application.is_relative_to(destination) and not root.is_relative_to(destination),
            "Receiving destination cannot contain the existing application or Workspace")
    require(not output.is_relative_to(destination) and not archive.is_relative_to(destination),
            "Keep archive and progress outside the new receiving directory")
    require(len({output, archive, reports, comparison}) == 4,
            "Archive, input documents and progress must have distinct paths")
    require(not args.archive.is_symlink() and not args.receive_into.is_symlink()
            and not args.output.is_symlink(), "Select original paths, not receiving aliases")

    sys.path.insert(0, str(application))
    from model import common, portable, workspace as workspace_module
    for module in (common, portable, workspace_module):
        require(Path(module.__file__).resolve().is_relative_to(application),
                "A capture module was imported from outside the selected application")
    require(callable(getattr(portable, "resume_restore", None)),
            "Install the maintained native portable.resume_restore before starting capture")
    workspace = workspace_module.Workspace(root, create=False)
    opener = load_opener()
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output.with_name("." + output.name + ".lock"),
                 os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        existed = output.exists()
        state = common.read_json(output) if existed else {"schema": SCHEMA, "steps": {}}
        require(state.get("schema") == SCHEMA and isinstance(state.get("steps"), dict),
                "Resume the original completed-study receiving record")
        intent = {"application": str(application), "workspace": str(root),
                  "archive": str(archive), "receive_into": str(destination),
                  "reports_sha256": common.file_digest(reports),
                  "comparison_sha256": common.file_digest(comparison),
                  "renderer_sha256": common.file_digest(application / "model/reach_chemistry/reporting.py")}
        require(state.get("intent", intent) == intent,
                "Resume with the original receiving paths, saved inputs and renderer")
        require(existed or not archive.exists(),
                "An existing archive requires its original capture intent; choose a new archive path")
        state["intent"] = intent
        state["capture_protocol"] = 2

        def save(name, value):
            state["steps"][name] = value
            common.atomic_json(output, state)
            return value

        # Save the complete request before any native capture/receive effect.
        common.atomic_json(output, state)
        selected_path = output.with_name(output.name + ".selection.json")
        inspected = opener.open_study(
            application, root, reports, comparison,
            output.with_name(output.name + ".original.json"), lock_fd=fd)
        selected = {key: inspected[key] for key in ("retained", "files", "producers")}
        if selected_path.exists():
            require(common.read_json(selected_path) == selected,
                    "The selected original study or producer edition changed during continuation")
        else:
            common.atomic_json(selected_path, selected, immutable=True)
        archive_intent = {"path": str(archive), "selection": SELECTION,
                          "selected_science_sha256": common.digest(selected)}
        require(state["steps"].get("archive_intent", archive_intent) == archive_intent,
                "Retain the original capture's complete scientific selection")
        save("archive_intent", archive_intent)

        if not archive.exists():
            require("backup" not in state["steps"],
                    "Restore the already completed original archive before continuing")
            print("Capturing the selected complete scientific Workspace and application.", flush=True)
            native = portable.backup(workspace, archive, **SELECTION)
        else:
            native = state["steps"].get("backup")
        manifest, identity = verified_archive(archive, workspace, selected, native, portable)
        save("backup", {**(native or {}), **identity, "schema": portable.FORMAT})
        # A published native receive may precede its caller's progress write.
        # The original resume API reconciles that publication without replacing it.
        old_receiving = state["steps"].get("restore")
        if old_receiving is not None:
            require(old_receiving["archive_sha256"] == identity["sha256"]
                    and Path(old_receiving["directory"]).resolve() == destination,
                    "Retained receiving result belongs to another archive or destination")
        if destination.exists():
            receiving = portable.resume_restore(
                archive, destination, expected_archive_sha256=identity["sha256"])
        else:
            require(old_receiving is None,
                    "Restore the original receiving directory before continuing")
            receiving = portable.restore(archive, destination)
        require(receiving["identity"] == "MATCH"
                and receiving["archive_sha256"] == identity["sha256"]
                and receiving["project"] == selected["retained"]["project"],
                "Native receiving changed the complete selected archive")
        save("restore", receiving)
        cold = opener.open_study(
            Path(receiving["application"]), Path(receiving["workspace"]),
            reports, comparison, output.with_name(output.name + ".cold.json"),
            expected=selected, lock_fd=fd)
        # The full cold record includes all original science, artifact bytes and
        # exact imported producer identities; the original compact view stays useful.
        save("cold_receiving", {
            "path": str(output.with_name(output.name + ".cold.json")),
            "sha256": common.file_digest(output.with_name(output.name + ".cold.json")),
            "retained_science_sha256": cold["retained_science_sha256"],
            "loaded_source": cold["loaded_source"]})
        save("reopened", {
            "project_id": cold["project_id"],
            "analyses": {mode: row["run_id"] for mode, row in cold["analyses"].items()},
            "reports": {mode: row["report_id"] for mode, row in cold["analyses"].items()},
            "sources": {mode: row["source_id"] for mode, row in cold["analyses"].items()},
            "frontier_id": selected["retained"]["frontier"]["id"],
            "plan_ids": [row["plan_id"] for row in cold["plans"]],
            "comparison_id": cold["comparison_id"]})
        state["state"] = "complete"
        common.atomic_json(output, state)
        return state
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--comparison", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--receive-into", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    state = capture(parser.parse_args())
    print(json.dumps({"state": state["state"], "archive": state["steps"]["backup"],
                      "received": state["steps"]["restore"],
                      "reopened": state["steps"]["reopened"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
