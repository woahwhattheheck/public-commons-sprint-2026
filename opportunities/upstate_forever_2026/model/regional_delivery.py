"""Complete a retained regional model as maps, decision tables and an editable project."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from .common import (MAP_IDS, atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, now, read_json, relative_file)
from .native_batch import load_receiving
from .workspace import Workspace

SCHEMA = "upstate.regional-delivery/v1"
PROGRESS_SCHEMA = "upstate.regional-delivery-progress/v1"


def _artifact(root, item):
    """Reuse the completed producer's byte identity without rereading large rasters."""
    path = relative_file(root, item["path"])
    if path.stat().st_size != item["bytes"]:
        raise ValueError("A completed delivery file changed length: " + item["path"])
    return {**item, "path": str(path)}


def _progress(path, record, phase, **changes):
    record.update(changes, phase=phase, updated_at=now())
    record.pop("error", None)
    atomic_json(path, record)
    print(json.dumps({"operation": "regional-delivery", "id": record["id"],
                      "phase": phase, "state": record["state"]}), flush=True)


def _file_state(item):
    stat = Path(item["path"]).stat()
    return {"bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns,
            "ctime_ns": stat.st_ctime_ns}


def _reusable(result):
    """Read cached outputs only when filesystem metadata indicates a change."""
    for item in result["retained_files"]:
        path = Path(item["path"])
        if not path.is_file():
            return False
        current = _file_state(item)
        if current != item["file_state"]:
            if current["bytes"] != item["bytes"] or file_digest(path) != item["sha256"]:
                raise ValueError("A retained regional output changed: " + str(path))
    receiving = result["receiving"]
    return (Path(receiving["workspace"]) / "workspace.json").is_file()


def _recover_received(archive, destination):
    """Recover a rename completed immediately before its receiving record was saved."""
    from .portable import inspect_archive, member_name, received_delivery
    manifest = inspect_archive(archive["path"], verify=False)
    for name, item in manifest["members"].items():
        path = destination.joinpath(*member_name(name).parts)
        if (not path.is_file() or path.is_symlink() or path.stat().st_size != item["bytes"]
                or file_digest(path) != item["sha256"]):
            raise ValueError("The receiving directory contains different work; choose a new receiving directory")
    workspace = Workspace(destination / "workspace")
    if workspace.project != manifest["project"]:
        raise ValueError("The receiving directory belongs to another project")
    return {"schema": "upstate.scientific-workspace-receiving/v1",
            "project": manifest["project"], "directory": str(destination),
            "workspace": str(destination / "workspace"),
            "application": str(destination / "application"),
            "archive_sha256": archive["sha256"], "members": len(manifest["members"]),
            "selection": manifest["selection"], "identity": "MATCH",
            **received_delivery(manifest, destination)}


def _receive(archive, destination, output, model):
    from .portable import restore
    receipt_path = output / "receiving.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if (receipt["archive_sha256"] != archive["sha256"]
                or Path(receipt["directory"]) != destination
                or receipt["project"]["id"] != model["workspace_id"]):
            raise ValueError("The retained receiving record selects another project or archive")
        if not destination.exists():
            receipt = restore(archive["path"], destination)
    elif destination.exists():
        receipt = _recover_received(archive, destination)
    else:
        receipt = restore(archive["path"], destination)
    atomic_json(receipt_path, receipt, immutable=True)

    # Open the delivered application, with its own imports, against its delivered project.
    command = [sys.executable, "-B", str(Path(receipt["application"]) / "model" / "cli.py"),
               "--workspace", receipt["workspace"], "overview"]
    completed = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True)
    atomic_bytes(output / "reopened-workspace.json", completed.stdout)
    if completed.stderr:
        atomic_bytes(output / "reopened-workspace.stderr", completed.stderr)
    if completed.returncode:
        raise RuntimeError("The delivered workspace exited " + str(completed.returncode) + ": " +
                           completed.stderr.decode("utf-8", errors="replace")[-12000:])
    overview = json.loads(completed.stdout)
    if overview["project"]["id"] != model["workspace_id"]:
        raise ValueError("The delivered application reopened another project")
    available = {item["id"]: item for item in overview["runs"]}
    for run_id in model["runs"].values():
        if run_id not in available or available[run_id]["state"] != "complete":
            raise ValueError("The delivered project is missing a completed selected run")
    if model["comparison_id"] not in {item["id"] for item in overview["comparisons"]}:
        raise ValueError("The delivered project is missing the selected comparison")
    return {**receipt, "reopened_cli": _artifact(
        output, describe_file(output, output / "reopened-workspace.json")),
        "selected_run_ids": model["runs"], "comparison_id": model["comparison_id"]}


def complete_delivery(model_receiving, *, output, workspace_path=None, receive_directory=None):
    from .cartography import MAP_RENDERER_VERSION
    from .scenario_summary import build_summary, write_summary
    from .delivery_review_version import REPORT_EDITION
    from .portable import application_digest
    from .delivery import DELIVERY_EDITION

    model, workspace, original = load_receiving(model_receiving, workspace_path)
    output = Path(output).resolve()
    destination = Path(receive_directory).resolve() if receive_directory else output / "received-project"
    if output.is_relative_to(workspace.root) or destination.is_relative_to(workspace.root):
        raise ValueError("Put regional output and the receiving project outside the original workspace")
    if output == destination or output.is_relative_to(destination):
        raise ValueError("The receiving directory must be separate from the output records")
    output.mkdir(parents=True, exist_ok=True)
    selection = {"schema": SCHEMA, "workspace_id": model["workspace_id"],
                 "native_selection_id": model["native_selection_id"],
                 "model_receiving_sha256": hashlib.sha256(original).hexdigest(),
                 "map_renderer": MAP_RENDERER_VERSION,
                 "client_report_edition": REPORT_EDITION, "delivery_edition": DELIVERY_EDITION,
                 "application_sha256": application_digest(),
                 "receive_directory": str(destination)}
    key = digest(selection)
    progress_path, result_path = output / "progress.json", output / "regional-delivery.json"
    with held(output / ".regional-delivery.lock", blocking=False):
        atomic_json(output / "input.json", selection, immutable=True)
        atomic_bytes(output / "original-model-receiving.json", original, immutable=True)
        if result_path.exists():
            completed = read_json(result_path)
            if completed["id"] != key:
                raise ValueError("Select a new output directory for this regional selection")
            if _reusable(completed):
                return {**completed, "reused": True}
        state = read_json(progress_path) if progress_path.exists() else {
            "schema": PROGRESS_SCHEMA, "id": key, "workspace_id": model["workspace_id"],
            "created_at": now()}
        if state["id"] != key:
            raise ValueError("This output directory already retains another regional selection")
        state["state"] = "running"
        try:
            _progress(progress_path, state, "maps-and-package")
            # The original delivery engine reuses its retained files and completed stages.
            delivery = workspace.build_delivery(model["delivery_selection"])
            if delivery["state"] != "complete":
                raise RuntimeError("The selected regional GIS delivery has not completed")
            directory = workspace.root / "deliveries" / delivery["id"]
            _progress(progress_path, state, "scenario-decision-tables", delivery_id=delivery["id"])
            summary = build_summary(workspace, model, delivery)
            summary_files = {name: _artifact(output, item)
                             for name, item in write_summary(output, summary).items()}
            working = _artifact(directory, delivery["files"]["working_archive"])
            archive = _artifact(directory, delivery["files"]["delivery_archive"])
            maps = {name: _artifact(directory, item) for name, item in delivery["maps"].items()}
            report = _artifact(directory, delivery["files"]["report"])
            report_companions = {name: _artifact(directory, delivery["files"][name])
                for name in ("report_html", "report_markdown", "report_data")}
            asset_paths = set(delivery["manifest"]["project_assets"])
            project_assets = {name: _artifact(directory, item)
                for name, item in delivery["files"].items() if item["path"] in asset_paths}
            scales = _artifact(directory, delivery["files"]["display_scales"])
            _progress(progress_path, state, "reopen-editable-project",
                      scenario_summary_id=summary["id"])
            received = _receive(working, destination, output, model)
            retained = list({item["path"]: item for item in (
                archive, working, report, scales, *maps.values(), *summary_files.values(),
                *report_companions.values(), *project_assets.values(), received["reopened_cli"])
                }.values())
            result = {"schema": SCHEMA, "id": key, "state": "complete",
                      "completed_at": now(), "workspace_id": model["workspace_id"],
                      "native_selection_id": model["native_selection_id"],
                      "source_reference": model.get("source_reference"),
                      "source_collection_id": model["source_collection_id"],
                      "grid_id": model["grid_id"], "runs": model["runs"],
                      "comparison_id": model["comparison_id"], "delivery_id": delivery["id"],
                      "map_renderer": MAP_RENDERER_VERSION,
                      "map_families": sorted(set(delivery["manifest"]["maps"]) & set(MAP_IDS)),
                      "map_count": len(maps), "maps": maps, "display_scales": scales,
                      "report": report, "report_companions": report_companions,
                      "report_edition": REPORT_EDITION, "delivery_edition": DELIVERY_EDITION,
                      "project_assets": project_assets, "scenario_summary": summary_files,
                      "delivery_archive": archive, "working_archive": working,
                      "navigator": str(directory / delivery["package"]["path"] / "index.html"),
                      "receiving": received,
                      "retained_files": [{**item, "file_state": _file_state(item)} for item in retained]}
            atomic_json(result_path, result)
            _progress(progress_path, state, "complete", state="complete",
                      result=describe_file(output, result_path))
            return result
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(progress_path, state)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_receiving", type=Path)
    parser.add_argument("--workspace", type=Path, help="Current path of the original selected workspace")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receive-directory", type=Path)
    args = parser.parse_args(argv)
    try:
        result = complete_delivery(args.model_receiving, workspace_path=args.workspace,
                                   output=args.output, receive_directory=args.receive_directory)
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, OSError, RuntimeError, KeyError, ImportError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
