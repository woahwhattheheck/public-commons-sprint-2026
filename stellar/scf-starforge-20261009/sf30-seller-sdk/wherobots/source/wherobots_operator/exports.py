"""Inspect and resume the original complete portable and SF30 exports."""
from __future__ import annotations

import json
from pathlib import Path
import zipfile

from .storage import OperationError, digest, hash_file
from .portable import (_archive_manifest, _digest, _file_hash, _relative,
                       export_handover, export_dataset_handover)


def inspect_export(kind, source):
    source = Path(source).absolute()
    if source.is_symlink() or source.resolve() != source:
        raise OperationError("EXPORT_PATH", "Select the complete original export at its canonical path.")
    if kind == "workflow":
        before = _file_hash(source)
        with zipfile.ZipFile(source) as archive:
            manifest, _ = _archive_manifest(archive)
        if _file_hash(source) != before:
            raise OperationError("EXPORT_CHANGED", "The original complete archive changed during inspection.", status=409)
        workflow = next((item for item in manifest["records"] if item["kind"] == "workflow"
                         and item["id"] == manifest["workflow_id"]), None)
        if workflow is None:
            raise OperationError("EXPORT_WORKFLOW", "The complete handover omits its original workflow.")
        return {"schema": manifest["schema"], "package_id": manifest["package_id"],
                "workflow_id": manifest["workflow_id"], "source_workspace_id": manifest["source_workspace_id"],
                "workflow_revision": workflow["revision_sha256"], "path": str(source), **before,
                "records": len(manifest["records"]), "objects": len(manifest["objects"]),
                "files": len(manifest["files"]) + 1,
                "editions": [item["id"] for item in manifest["records"] if item["kind"] == "edition"]}
    if kind != "dataset":
        raise OperationError("EXPORT_KIND", "Inspect a workflow handover or original dataset package.")
    receipt_path = source / "package.json"
    if not receipt_path.is_file() or receipt_path.is_symlink() or receipt_path.stat().st_size > 32 * 1024 * 1024:
        raise OperationError("EXPORT_MANIFEST", "Select the complete original dataset package.")
    raw = receipt_path.read_bytes()
    receipt = json.loads(raw)
    if receipt.get("schema") != "stellar-forge.wherobots-dataset-package.v1" or (
            receipt.get("package_id") != _digest({key: value for key, value in receipt.items() if key != "package_id"})):
        raise OperationError("EXPORT_MANIFEST", "The original dataset package identity differs.")
    if not isinstance(receipt.get("files"), list):
        raise OperationError("EXPORT_FILES", "The original package requires its complete file inventory.")
    seen = set()
    for item in receipt["files"]:
        name = _relative(item["path"])
        if name in seen:
            raise OperationError("EXPORT_FILES", "The original dataset manifest repeats a file.")
        seen.add(name)
        file = source / name
        if file.is_symlink() or file.resolve() != file or not file.is_file() or _file_hash(file) != {
                key: item[key] for key in ("sha256", "bytes")}:
            raise OperationError("EXPORT_CHANGED", "An original dataset member changed: " + str(name), status=409)
    if not {"source.json", "dataset.json", "dataset.csv"} <= seen:
        raise OperationError("EXPORT_FILES", "The original dataset package omits its configuration, source or complete data.")
    observed = {path.relative_to(source).as_posix() for path in source.rglob("*") if path.is_file()}
    if observed != seen | {"package.json"} or any(path.is_symlink() for path in source.rglob("*")):
        raise OperationError("EXPORT_FILES", "The complete dataset directory differs from its original inventory.")
    if receipt_path.read_bytes() != raw:
        raise OperationError("EXPORT_CHANGED", "The original dataset manifest changed during inspection.", status=409)
    original = json.loads((source / "source.json").read_bytes())
    for key in ("edition_id", "dataset_id", "source_binding_sha256"):
        if original.get(key) != receipt.get(key):
            raise OperationError("EXPORT_BINDING", "The original dataset source and package identities differ.")
    return {**receipt, "directory": str(source), "source": original, "reused": True}


def export_selected(workspace, operation, args):
    kind = "workflow" if operation == "export" else "dataset"
    destination = Path(args["destination"]).absolute()
    selection = {"operation": operation, "destination": str(destination),
                 **{key: args[key] for key in ("workflow_id", "edition_id", "dataset_id") if key in args}}
    lock = "export-" + args.get("export_id", digest(selection))
    with workspace.operation_lock(lock):
        completed = destination.is_file() if kind == "workflow" else (destination / "package.json").is_file()
        if completed and args.get("reuse_existing", False):
            retained = inspect_export(kind, destination)
            for key in ("workflow_id", "edition_id", "dataset_id"):
                if key in args and retained.get(key) != args[key]:
                    raise OperationError("EXPORT_SELECTION", "The existing export belongs to a different original selection.", status=409)
            if kind == "workflow":
                if retained["source_workspace_id"] != workspace.workspace_id or (
                        args.get("expected_revision") is not None and retained["workflow_revision"] != args["expected_revision"]):
                    raise OperationError("EXPORT_SELECTION", "The existing archive belongs to another original workspace or workflow revision.", status=409)
            return retained
        with workspace.read_snapshot():
            record = workspace.get_record("workflow" if kind == "workflow" else "edition",
                                          args["workflow_id"] if kind == "workflow" else args["edition_id"])
            if args.get("expected_revision") is not None and record["revision_sha256"] != args["expected_revision"]:
                raise OperationError("REVISION_CONFLICT", "The original export selection changed; reopen its saved revision.", status=409)
            if kind == "workflow":
                return export_handover(workspace, args["workflow_id"], destination)
            return export_dataset_handover(workspace, args["edition_id"], args["dataset_id"], destination)
