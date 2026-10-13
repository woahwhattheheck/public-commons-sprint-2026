#!/usr/bin/env python3
"""Complete a saved Monitoring comparison, scientific report and optional full receiving."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report-title", default="Regional monitoring budget choices — scientific report")
    parser.add_argument("--contact", type=Path)
    parser.add_argument("--transfer", action="store_true")
    args = parser.parse_args()
    app = args.application.expanduser().resolve(strict=True)
    root = args.workspace.expanduser().resolve(strict=True)
    output = args.output.expanduser().resolve()
    if output == root or output.is_relative_to(root) or output == app or output.is_relative_to(app):
        raise ValueError("Keep the receiving output outside the original Workspace and application.")
    sys.path[:0] = [str(app), str(app / "operator")]
    from model.common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
    from model.workspace import Workspace
    from model import monitoring_frontier_comparison as comparisons
    from model import monitoring_report_source as report_sources
    from model import scientific_report_editions as editions
    from model import portable
    workspace = Workspace(root, create=False)
    selection_path = args.selection.expanduser().resolve(strict=True)
    selection_body = selection_path.read_bytes()
    selection = json.loads(selection_body)
    if not isinstance(selection, dict) or set(selection) - {"frontier_id", "baseline_plan_id", "context_ids", "title"}:
        raise ValueError("Use the complete native comparison selection from this bank.")
    contact = read_json(args.contact) if args.contact else {}
    if not isinstance(contact, dict):
        raise ValueError("Report contact must be an object.")
    implementation_paths = [
        "model/monitoring_frontier_comparison.py", "model/monitoring_comparison_report.py",
        "model/monitoring_report_source.py", "model/scientific_report_editions.py",
        "model/observed_context.py", "model/observed_report_render.py",
        "model/scientific_figures.py", "model/scientific_map_figures.py",
        "operator/source_report_editions.py", "model/portable.py",
    ]
    request = {"schema": "upstate.monitoring-native-report-request/v1",
               "workspace": str(root), "project_id": workspace.project["id"],
               "application": str(app), "script_sha256": file_digest(Path(__file__)),
               "selection": selection, "selection_sha256": hashlib.sha256(selection_body).hexdigest(),
               "report_title": args.report_title, "contact": contact, "transfer": args.transfer,
               "implementation": {name: file_digest(app / name) for name in implementation_paths}}
    output.mkdir(parents=True, exist_ok=True)
    state_path = output / "progress.json"
    state = {"schema": "upstate.monitoring-native-report-receiving/v1", "request": request,
             "state": "running", "steps": {}}

    def flush(stage):
        state["current_step"] = stage
        atomic_json(state_path, state)

    def record(stage, value):
        state["steps"][stage] = value
        flush(stage)
        return value

    def copy_original(source, destination, expected):
        source, destination = Path(source), Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.stat().st_size != expected["bytes"] or file_digest(destination) != expected["sha256"]:
                raise ValueError("An existing receiving output differs: " + str(destination))
            return describe_file(output, destination)
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".retained-", delete=False) as target:
                pending = Path(target.name)
                count, checksum = 0, hashlib.sha256()
                with source.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        target.write(block)
                        count += len(block)
                        checksum.update(block)
                target.flush()
                os.fsync(target.fileno())
            if count != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
                raise ValueError("An original report output changed while copying.")
            os.link(pending, destination)
            fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            return describe_file(output, destination)
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)

    def verify_records(ws, comparison_id, source_id, edition_id):
        comparison = comparisons.inspect(ws, comparison_id)
        source = report_sources.inspect(ws, source_id, verify=True)
        edition, directory, operation = editions.inspect(ws, edition_id)
        if source["selection"].get("comparison_id") != comparison["id"]:
            raise ValueError("Scientific report source identifies another saved comparison.")
        if not any(row["source_collection_id"] == source["source"]["source_collection_id"]
                   and row["source_id"] == source["source"]["source_id"] for row in edition["sources"]):
            raise ValueError("Scientific report edition lost its original comparison source.")
        return comparison, source, edition, directory

    with held(output / ".receiving.lock", blocking=False):
        request_path = output / "request.json"
        if request_path.exists():
            if read_json(request_path) != request:
                raise ValueError("Keep this receiving output with its original source selection and implementation.")
            if state_path.exists():
                state = read_json(state_path)
                if state.get("request") != request:
                    raise ValueError("The retained operation journal identifies another request.")
        else:
            unexpected = [path.name for path in output.iterdir() if path.name != ".receiving.lock"]
            if unexpected:
                raise ValueError("Choose a fresh receiving output directory.")
            atomic_json(request_path, request, immutable=True)
        try:
            state["state"] = "running"
            state.pop("error", None)
            flush("saved-comparison")
            if "comparison" in state["steps"]:
                comparison = comparisons.inspect(workspace, state["steps"]["comparison"]["id"])
            else:
                comparison = comparisons.prepare(workspace, **selection)
                record("comparison", comparison)
            if comparison["frontier_id"] != selection["frontier_id"]:
                raise ValueError("Saved comparison identifies another frontier.")
            atomic_json(output / "comparison.json", comparison, immutable=True)
            flush("complete-comparison-packet")
            packet = comparisons.export_comparison(workspace, comparison_id=comparison["id"],
                                                   export_root=output / "comparison-files")
            if Path(packet["path"]).stat().st_size != packet["bytes"] or file_digest(packet["path"]) != packet["sha256"]:
                raise ValueError("The complete original comparison packet changed.")
            record("comparison_packet", packet)
            flush("original-scientific-source")
            if "report_source" in state["steps"]:
                source = report_sources.inspect(workspace, state["steps"]["report_source"]["id"], verify=True)
            else:
                prepared = report_sources.prepare(workspace, {"comparison_id": comparison["id"],
                                                             "title": args.report_title})
                source = report_sources.inspect(workspace, prepared["id"], verify=True)
                record("report_source", source)
            atomic_json(output / "comparison-report-source.json", source, immutable=True)
            payload = {"sources": [source["source"]], "title": source["title"], "contact": contact}
            preview_path = output / "scientific-preview.json"
            if preview_path.exists():
                preview = read_json(preview_path)
            else:
                preview = editions.preview(workspace, payload)
                atomic_json(preview_path, preview, immutable=True)
            flush("original-scientific-render")
            if (editions.directory(workspace, preview["id"]) / "edition.json").exists():
                edition, directory, operation = editions.inspect(workspace, preview["id"])
            else:
                result = editions.render(workspace, {**payload, "preview_id": preview["id"]})
                edition, directory, operation = editions.inspect(workspace, result["scientific_report_edition_id"])
            record("scientific_edition", {"id": edition["id"], "directory": str(directory)})
            comparison, source, edition, directory = verify_records(
                workspace, comparison["id"], source["id"], edition["id"])
            flush("original-scientific-archive")
            from server import Operator, Fault
            from source_report_editions import ScientificReportEditions
            operator = Operator(root, output / "operator-state", create=False)
            try:
                archive_result = ScientificReportEditions(operator, Fault).export(operator.primary, edition["id"])
            finally:
                operator.close()
            archive_receipt = read_json(directory / "report-files.json")
            archive_path = verify_file(directory, archive_receipt["file"])
            files = editions.files(edition, directory)
            files["complete_report_archive"] = archive_receipt["file"]
            copied = {}
            for role, item in files.items():
                original = verify_file(directory, item)
                copied[role] = copy_original(original, output / "scientific-report" / item["path"], item)
            record("scientific_files", copied)
            receiving = None
            if args.transfer:
                flush("complete-workspace-backup")
                archive = output / "complete-scientific-workspace.zip"
                required = [
                    comparisons.COLLECTION + "/" + comparison["id"] + ".json",
                    report_sources.FOLDER + "/" + source["id"] + "/report.json",
                    editions.KIND + "/" + edition["id"] + "/edition.json",
                ]
                backup_intent = {"path": str(archive), "project_id": workspace.project["id"],
                                 "comparison_id": comparison["id"], "report_source_id": source["id"],
                                 "scientific_report_edition_id": edition["id"]}
                previous_intent = state["steps"].get("workspace_backup_intent")
                pending_archive = archive.parent / (".archive-" + archive.name + ".pending")
                if previous_intent is not None and previous_intent != backup_intent:
                    raise ValueError("Retain the original full-Workspace backup selection.")
                if pending_archive.exists() and not archive.exists():
                    if previous_intent != backup_intent:
                        raise ValueError("An unfinished archive belongs to another retained operation.")
                    with held(root / ".workspace.lock", blocking=False):
                        pending_archive.unlink()
                if previous_intent is None:
                    record("workspace_backup_intent", backup_intent)
                if archive.exists():
                    captured = portable.inspect_archive(archive, verify=True)
                    if captured["project"] != workspace.project:
                        raise ValueError("The retained archive belongs to another project.")
                    for name in required:
                        wanted = describe_file(root, root / name)
                        original = captured["members"].get("workspace/" + name, {})
                        if any(original.get(key) != wanted[key] for key in ("bytes", "sha256")):
                            raise ValueError("The original complete archive lacks this exact scientific course.")
                    backup = {"path": str(archive), "bytes": archive.stat().st_size,
                              "sha256": file_digest(archive), "members": len(captured["members"]),
                              "project_id": workspace.project["id"]}
                else:
                    backup = portable.backup(workspace, archive)
                record("workspace_backup", backup)
                flush("independent-workspace-receiving")
                destination = output / "received"
                if destination.exists():
                    captured = portable.inspect_archive(archive, verify=False)
                    for name, item in captured["members"].items():
                        verify_file(destination, {**item, "path": name})
                    receiving = {"workspace": str(destination / "workspace"),
                                 "application": str(destination / "application"),
                                 "directory": str(destination), "archive_sha256": backup["sha256"],
                                 "identity": "MATCH", "reopened_existing_receiving": True}
                else:
                    receiving = portable.restore(archive, destination)
                reopened = Workspace(receiving["workspace"], create=False)
                if reopened.project != workspace.project:
                    raise ValueError("Whole receiving changed the original project.")
                copies = verify_records(reopened, comparison["id"], source["id"], edition["id"])
                if list(copies[:3]) != [comparison, source, edition]:
                    raise ValueError("Whole receiving changed an original comparison, source or report edition.")
                record("workspace_receiving", receiving)
            result = {"schema": state["schema"], "state": "complete",
                      "project_id": workspace.project["id"], "comparison_id": comparison["id"],
                      "comparison_report_id": source["id"], "scientific_report_edition_id": edition["id"],
                      "comparison_packet": packet, "scientific_report_files": copied,
                      "source": source["source"], "receiving": receiving}
            atomic_json(output / "result.json", result)
            state["state"] = "complete"
            state["result"] = result
            flush("complete")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return result
        except BaseException as error:
            state["state"] = "interrupted"
            state["error"] = {"type": type(error).__name__, "message": str(error)}
            atomic_json(state_path, state)
            raise


if __name__ == "__main__":
    main()
