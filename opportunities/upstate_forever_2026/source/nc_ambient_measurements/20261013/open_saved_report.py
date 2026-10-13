#!/usr/bin/env python3
"""Open an original NC ambient-measurement report and receive its saved study."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

APPLICATION = Path(__file__).resolve().parents[3]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

SCHEMA = "upstate.nc-ambient-native-opening/v1"
SOURCE_ID = "nc-ambient-measurements-observed-report"
MANIFEST = "nc_ambient_measurements.sources.json"

def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

def relative_name(value):
    path = PurePosixPath(value)
    if (not isinstance(value, str) or not path.parts or path.is_absolute()
            or str(path) != value or any(part in (".", "..") for part in path.parts)
            or "\\" in value or "\0" in value or ":" in path.parts[0]):
        raise ValueError("Keep original report members as portable relative paths")
    return path

def artifact(root, path):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": file_hash(path)}

def copy_member(source_root, output, item):
    """Copy the complete verified original, preserving its relative report links."""
    from model.common import verify_file
    name = relative_name(item["path"])
    verify_file(source_root, item)
    source = (source_root / name).resolve(strict=True)
    if not source.is_relative_to(source_root.resolve()) or not source.is_file():
        raise ValueError("A report member leaves its saved edition")
    target = output.joinpath(*name.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or not target.parent.resolve().is_relative_to(output.resolve()):
        raise ValueError("Keep copied report members inside their receiving directory")
    if target.exists():
        verify_file(output, item)
        return
    fd, temporary = tempfile.mkstemp(prefix=".report-member-", dir=target.parent)
    pending = Path(temporary)
    try:
        checksum, size = hashlib.sha256(), 0
        with source.open("rb") as incoming, os.fdopen(fd, "wb") as outgoing:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(chunk)
                checksum.update(chunk)
                size += len(chunk)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
            raise ValueError("Original report member changed while being copied: " + item["path"])
        try:
            os.link(pending, target)
        except FileExistsError:
            verify_file(output, item)
        verify_file(output, item)
        verify_file(source_root, item)
    finally:
        pending.unlink(missing_ok=True)

def source_choices(preceding, collection_id, source_id):
    if not isinstance(preceding, list):
        raise ValueError("Preceding report sources must be an ordered JSON array")
    choices = []
    for row in [*preceding, {"source_collection_id": collection_id, "source_id": source_id}]:
        if (not isinstance(row, dict) or set(row) != {"source_collection_id", "source_id"}
                or any(not isinstance(value, str) or not value for value in row.values())):
            raise ValueError("Each report source needs its retained collection ID and source ID")
        if row in choices:
            raise ValueError("Do not repeat the same original report source in an ordered edition")
        choices.append(dict(row))
    return choices

def progress(stage, **values):
    print(json.dumps({"stage": stage, **values}, ensure_ascii=False, allow_nan=False),
          file=sys.stderr, flush=True)

COLD_OPEN = r"""
import json, sys
from pathlib import Path
application, root, key, transfer_id = map(str, sys.argv[1:])
sys.path.insert(0, application)
from model.workspace import Workspace
from model import scientific_report_editions, study_transfer
from model.common import digest
workspace = Workspace(Path(root))
record, directory, result = scientific_report_editions.inspect(workspace, key)
transfers = [item for item in study_transfer.verify_received_studies(workspace)
             if item["id"] == transfer_id]
if len(transfers) != 1 or transfers[0].get("identity") != "MATCH":
    raise ValueError("The received original selected-study receipt is absent or changed")
print(json.dumps({"project_id":workspace.project["id"],
    "scientific_report_edition_id":record["id"],
    "edition_sha256":digest(record), "operation_sha256":digest(result),
    "report_directory":str(directory), "source_count":record["source_count"],
    "figure_count":record["figure_count"], "section_count":record["section_count"],
    "transfers":transfers, "workspace_module":str(__import__("model.workspace",fromlist=["__file__"]).__file__)},
    ensure_ascii=False, allow_nan=False))
"""

def open_report(workspace, output, manifest, *, source_id=SOURCE_ID, title=None,
                preceding=None, receive=True, expected_project_id=None):
    from model import portable, scientific_report_editions as editions, study_transfer
    from model.common import atomic_json, digest, held, read_json, verify_file

    preceding = [] if preceding is None else preceding
    if not isinstance(preceding, list):
        raise ValueError("Preceding report sources must be an ordered JSON array")
    if expected_project_id and workspace.project["id"] != expected_project_id:
        raise ValueError("The selected Workspace belongs to a different original project")
    output = Path(output).expanduser().resolve()
    manifest = Path(manifest).expanduser().resolve(strict=True)
    if not manifest.is_file():
        raise ValueError("Select the complete original source manifest")
    for root in (Path(workspace.root).resolve(), APPLICATION.resolve()):
        if output == root or output.is_relative_to(root) or root.is_relative_to(output):
            raise ValueError("Keep this operation outside its original Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".nc-ambient-opening.lock", blocking=False):
        source_manifest = {"path": str(manifest), "bytes": manifest.stat().st_size,
                           "sha256": file_hash(manifest)}
        request = {"schema": SCHEMA, "project_id": workspace.project["id"],
                   "workspace": str(workspace.root), "manifest": source_manifest,
                   "source_id": source_id, "title": title, "preceding_sources": preceding or []}
        operation_id = digest(request)
        # Freeze the complete requested family before source import or rendering.
        atomic_json(output / "request.json", request, immutable=True)
        state_path = output / "opening.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": operation_id, "project_id": workspace.project["id"],
            "phase": "requested", "complete": False, "artifacts": {}}
        if state.get("schema") != SCHEMA or state.get("operation_id") != operation_id:
            raise ValueError("The operation directory belongs to another original report request")
        for item in state["artifacts"].values():
            verify_file(output, item)

        progress("source_import", operation_id=operation_id)
        collection = workspace.import_sources(manifest)
        if file_hash(manifest) != source_manifest["sha256"]:
            raise ValueError("The original source manifest changed during import")
        entry_path, entry = workspace.source_file(collection["id"], source_id)
        if (entry.get("kind") != "document"
                or not (entry.get("metadata", {}).get("report_schema") == "upstate.observed-report/v1"
                        or entry.get("role") == "OBSERVED_CONTEXT")):
            raise ValueError("The selected original source is absent from the Scientific report catalogue")
        if state.get("source_collection_id") not in (None, collection["id"]):
            raise ValueError("The source import changed the retained original collection")
        payload = {"sources": source_choices(preceding or [], collection["id"], source_id)}
        if title is not None:
            payload["title"] = title
        state.update(source_collection_id=collection["id"], source_id=source_id,
                     phase="source_imported", complete=False)
        atomic_json(state_path, state)

        preview_path = output / "report-preview.json"
        if preview_path.exists():
            preview = read_json(preview_path)
            if (preview.get("schema") != "upstate.observed-report-preview/v1"
                    or preview.get("id") != digest(preview.get("render_identity"))):
                raise ValueError("The saved report preview identity changed")
            editions.validate_request(workspace, payload, preview["render_identity"])
        else:
            preview = editions.preview(workspace, payload)
            atomic_json(preview_path, preview, immutable=True)
        state["artifacts"]["preview"] = artifact(output, preview_path)
        state.update(preview_id=preview["id"], phase="previewed")
        atomic_json(state_path, state)
        progress("render", preview_id=preview["id"])
        # The native engine recovers an already completed original operation first.
        # An unfinished original preview remains bound to its own rendering sources.
        result = editions.render(workspace, {**payload, "preview_id": preview["id"]})
        key = result["scientific_report_edition_id"]
        record, saved_directory, saved_operation = editions.inspect(workspace, key)
        if key != preview["id"]:
            raise ValueError("Rendering changed the selected original preview")
        state.update(scientific_report_edition_id=key, result=result, phase="rendered")
        atomic_json(state_path, state)

        report_root = output / "report"
        if report_root.is_symlink() or not report_root.resolve().is_relative_to(output):
            raise ValueError("Keep the copied report directory inside its original operation")
        report_root.mkdir(exist_ok=True)
        members = editions.files(record, saved_directory)
        by_path = {}
        for role, item in members.items():
            name = item["path"]
            if name in by_path and any(by_path[name][field] != item[field] for field in ("bytes", "sha256")):
                raise ValueError("Two report roles disagree about the original member")
            by_path[name] = item
            copy_member(saved_directory, report_root, item)
        inventory = {"schema": "upstate.nc-ambient-report-files/v1", "project_id": workspace.project["id"],
                     "scientific_report_edition_id": key, "source_choices": payload["sources"],
                     "files": members}
        atomic_json(output / "report-files.json", inventory, immutable=True)
        state["artifacts"]["report_inventory"] = artifact(output, output / "report-files.json")
        state["report_directory"] = str(report_root)
        state["saved_report_directory"] = str(saved_directory)
        state["open_in_operator"] = {"view": "Sources > Scientific report > Saved reports",
                                    "scientific_report_edition_id": key}
        state["phase"] = "report_copied"
        atomic_json(state_path, state)

        if receive:
            selected = {"schema": "upstate.study-selection/v1", "title": record["title"],
                        "roots": [{"kind": "scientific-report-editions", "id": key}],
                        "include_related_results": False}
            archive = output / "nc-ambient-selected-study.zip"
            progress("study_export", scientific_report_edition_id=key)
            state["study_export"] = study_transfer.export_study(
                workspace, archive, selected, progress=lambda value: progress("study_export", **value))
            state["artifacts"]["study_archive"] = artifact(output, archive)
            atomic_json(state_path, state)
            destination = output / "received"
            expected = state["artifacts"]["study_archive"]["sha256"]
            progress("independent_receive")
            restored = (portable.resume_restore(archive, destination, expected_archive_sha256=expected)
                        if destination.exists() else portable.restore(archive, destination))
            if restored.get("archive_sha256") != expected:
                raise ValueError("The received study differs from the original selected archive")
            state["receiving"] = restored
            atomic_json(state_path, state)
            # Use the restored application in a fresh interpreter: source imports
            # cannot silently resolve to the producing process's original modules.
            progress("cold_open")
            completed = subprocess.run(
                [sys.executable, "-B", "-c", COLD_OPEN,
                 str(destination / "application"), str(destination / "workspace"), key,
                 state["study_export"]["id"]],
                cwd=destination, text=True, capture_output=True)
            if completed.returncode:
                state["cold_open_error"] = {"returncode": completed.returncode,
                    "stdout": completed.stdout, "stderr": completed.stderr}
                atomic_json(state_path, state)
                raise RuntimeError("Cold received application could not open the saved report: "
                                   + completed.stderr.strip())
            reopened = json.loads(completed.stdout)
            if (reopened.get("project_id") != workspace.project["id"]
                    or reopened.get("scientific_report_edition_id") != key
                    or reopened.get("edition_sha256") != digest(record)
                    or reopened.get("operation_sha256") != digest(saved_operation)):
                raise ValueError("Cold receiving changed the original report or source binding")
            module = Path(reopened["workspace_module"]).resolve(strict=True)
            if not module.is_relative_to((destination / "application").resolve()):
                raise ValueError("Cold opening used a different installed application")
            atomic_json(output / "cold-opening.json", reopened, immutable=True)
            state["artifacts"]["cold_opening"] = artifact(output, output / "cold-opening.json")
            state["received"] = reopened
            state.pop("cold_open_error", None)
        state.update(complete=True, phase="received" if state.get("received") else "report_ready")
        atomic_json(state_path, state)
        progress("complete", operation_id=operation_id, phase=state["phase"])
        return state

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=APPLICATION / MANIFEST)
    parser.add_argument("--source-id", default=SOURCE_ID)
    parser.add_argument("--title")
    parser.add_argument("--expected-project-id")
    parser.add_argument("--preceding-sources", type=Path,
                        help="Ordered JSON array of existing original report source choices")
    parser.add_argument("--render-only", action="store_true",
                        help="Save/copy the complete native report; repeat without this flag to export/reopen")
    args = parser.parse_args(argv)
    try:
        from model.common import read_json
        from model.workspace import Workspace
        root = args.workspace.expanduser().resolve(strict=True)
        result = open_report(Workspace(root), args.output, args.manifest,
            source_id=args.source_id, title=args.title,
            preceding=read_json(args.preceding_sources) if args.preceding_sources else [],
            receive=not args.render_only, expected_project_id=args.expected_project_id)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, ValueError, KeyError, RuntimeError, ImportError) as error:
        parser.exit(2, "NC ambient native opening: " + str(error) + "\n")

if __name__ == "__main__":
    main()
