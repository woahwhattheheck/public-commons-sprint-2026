#!/usr/bin/env python3
"""Receive saved field choices, native reports and a complete independently reopened project."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import atomic_json, describe_file, held, read_json, verify_file
from model.workspace import Workspace
from model import monitoring_field_assignment as assignment
from model import portable


def _external_path(value, workspace):
    original = Path(value).expanduser()
    if original.is_symlink():
        raise ValueError("Choose an ordinary receiving path, not a symbolic link.")
    path = original.resolve()
    if path == workspace.root or path.is_relative_to(workspace.root) or path.is_relative_to(APP):
        raise ValueError("Choose a receiving path outside the application and original Workspace.")
    return path


def receive(workspace, output, request, *, receive_directory=None, python=None):
    output = _external_path(output, workspace)
    destination = _external_path(receive_directory, workspace) if receive_directory else None
    if destination is not None and (destination == output or output.is_relative_to(destination)):
        raise ValueError("Choose a separate new received-project directory outside the course output.")
    if output == workspace.root or output.is_relative_to(workspace.root) or output.is_relative_to(APP):
        raise ValueError("Choose a receiving output outside the application and original Workspace.")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        selection_path = output / "selection.json"
        selected = dict(schema="upstate.monitoring-field-assignment-receiving/v1",
                        project_id=workspace.project["id"], request=request,
                        receiving_directory=str(destination) if destination else None)
        atomic_json(selection_path, selected, immutable=True)
        receipt_path = output / "receiving.json"
        receipt = read_json(receipt_path) if receipt_path.exists() else {"selection": selected}
        if receipt["selection"] != selected:
            raise ValueError("Reuse this receiving directory only for its original assignment and destination.")
        result = assignment.build(workspace, request)
        receipt["assignment"] = result
        atomic_json(receipt_path, receipt)
        archive = output / "field-assignment-project.zip"
        if "archive" not in receipt:
            if not archive.exists():
                workspace.backup(archive)
            manifest = portable.inspect_archive(archive, verify=True)
            if manifest["project"]["id"] != workspace.project["id"]:
                raise ValueError("The existing archive belongs to another project.")
            # Reconcile backup's final publication before its outer receipt was saved.
            for row in result["files"].values():
                original = manifest["members"].get("workspace/" + row["path"])
                if not original or any(original.get(key) != row[key] for key in ("bytes", "sha256")):
                    raise ValueError("The original assignment report is absent from this captured project.")
            receipt["archive"] = describe_file(output, archive)
            atomic_json(receipt_path, receipt)
        archive = verify_file(output, receipt["archive"])
        if receive_directory:
            receiving = (portable.resume_restore(archive, destination,
                         expected_archive_sha256=receipt["archive"]["sha256"])
                         if destination.exists() else portable.restore(archive, destination))
            receipt["receiving"] = receiving
            atomic_json(receipt_path, receipt)
            # Run the ordinary read using the received application's own exact code.
            command = [python or sys.executable, "-B",
                       str(Path(receiving["application"]) / "source_tools" / "receive_monitoring_field_assignment.py"),
                       "--workspace", receiving["workspace"], "--inspect-assignment", result["id"]]
            cold = subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
            inspected = json.loads(cold.stdout)
            if (inspected["id"] != result["id"] or inspected["plan"] != result["plan"]
                    or inspected["report"]["id"] != result["report"]["id"]
                    or inspected["files"] != result["files"]):
                raise ValueError("The independently received original assignment or report differs.")
            receipt["cold_opening"] = dict(command=command, returncode=cold.returncode,
                                           assignment=inspected, stderr=cold.stderr)
        receipt["state"] = "complete"
        atomic_json(receipt_path, receipt)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output")
    parser.add_argument("--source-collection-id")
    parser.add_argument("--source-id", default="monitoring-field-planning")
    parser.add_argument("--selection-file")
    parser.add_argument("--native-selection-id")
    parser.add_argument("--title", default="Monitoring field assignments")
    parser.add_argument("--receive-directory")
    parser.add_argument("--python")
    parser.add_argument("--inspect-assignment")
    args = parser.parse_args()
    workspace = Workspace(args.workspace, create=False)
    if args.inspect_assignment:
        print(json.dumps(assignment.inspect(workspace, args.inspect_assignment), ensure_ascii=False, indent=2))
        return
    if not args.output:
        parser.error("--output is required for native receiving.")
    saved = _external_path(args.output, workspace) / "selection.json"
    if saved.exists():
        selected = read_json(saved)
        request = selected["request"]
        if args.native_selection_id and args.native_selection_id != request.get("selection_record_id"):
            raise ValueError("Resume with the same original native field-selection record.")
        if args.selection_file:
            incoming = Path(args.selection_file).read_bytes().decode("utf-8")
            if incoming != request["selection_text"]:
                raise ValueError("Resume with the same original saved field-selection bytes.")
        if args.source_collection_id and args.source_collection_id != request["source"]["source_collection_id"]:
            raise ValueError("Resume with the same original source collection.")
        destination = args.receive_directory or selected["receiving_directory"]
    else:
        if args.native_selection_id:
            if args.selection_file or args.source_collection_id:
                parser.error("Choose the native saved selection or an original source plus file, not both.")
            original = assignment.saved_selection(workspace, args.native_selection_id)
            request = dict(source=original["source"], selection_text=original["selection_text"],
                           selection_record_id=original["selection_record_id"], title=args.title)
        else:
            if not args.source_collection_id or not args.selection_file:
                parser.error("First receiving needs --native-selection-id or --source-collection-id plus --selection-file.")
            request = dict(source={"source_collection_id": args.source_collection_id, "source_id": args.source_id},
                           selection_text=Path(args.selection_file).read_bytes().decode("utf-8"), title=args.title)
        prepared = assignment.preview(workspace, request)
        request["expected_id"] = prepared["id"]
        destination = args.receive_directory
    print(json.dumps(receive(workspace, args.output, request, receive_directory=destination,
                             python=args.python), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
