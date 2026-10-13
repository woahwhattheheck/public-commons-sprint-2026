"""Receive a retained watershed edition and reopen its original saved report.

Run from the maintained application with its existing Python environment:
  python -B source_tools/receive_watershed_edition.py \
    --application APPLICATION --manifest COMPLETE_SOURCES_JSON --output NEW_DIRECTORY

The existing Workspace importer, completed-report receiver, watershed provider,
selection exporter and portable archive engine perform the actual operations.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

SCHEMA = "upstate.watershed-edition-receiving/v1"
CONTEXT_SOURCE = "upper-savannah-water-context-domain217-20261013"
RECEIPT_MEMBER = "received/watershed-context-20261013/run-receipt.json"
ARCHIVE_MEMBER = "received/watershed-context-20261013/eco-watershed13-received.zip"
ARCHIVE_SHA256 = "716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5"


def _sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _member(root, name):
    if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
        raise ValueError("Invalid retained source member")
    relative = Path(name)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
        raise ValueError("Retained members must be portable relative paths")
    path = root / relative
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Retained source member is unavailable: " + name)
    return path


def _file(path, *, name=None):
    path = Path(path)
    return {"path": name if name is not None else str(path),
            "bytes": path.stat().st_size, "sha256": _sha(path)}


def _checked_file(root, descriptor, *, name=None):
    member = name if name is not None else descriptor.get("view_path", descriptor.get("filename"))
    path = _member(root, member)
    actual = _file(path, name=member)
    if actual["bytes"] != descriptor["bytes"] or actual["sha256"] != descriptor["sha256"]:
        raise ValueError("Retained file differs from its original identity: " + member)
    return actual


class ReceivingFault(RuntimeError):
    def __init__(self, code, message, status=500):
        self.code, self.status = code, status
        super().__init__(message)


class NativeWorkspaceHost:
    """Filesystem adapter for the maintained provider's Workspace/file protocol.

    The provider uses its original report and export implementations. Downloads
    here identify real files in the selected Workspace for a native CLI caller.
    """

    def __init__(self, workspace):
        self.workspace = workspace
        self.key = str(workspace.root)

    def ws(self, key):
        if key != self.key:
            raise ValueError("This native receiving operation selected another Workspace")
        return self.workspace

    def _ticket(self, key, path, descriptor, title):
        workspace = self.ws(key)
        path = Path(path)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(workspace.root.resolve()):
            raise ValueError("The selected download is outside the retained Workspace")
        actual = _file(path)
        if actual["bytes"] != descriptor["bytes"] or actual["sha256"] != descriptor["sha256"]:
            raise ValueError("The selected download changed: " + str(path))
        return {**actual, "filename": path.name, "title": title}

    def _files(self, key, record, directory):
        result = []
        for name, descriptor in sorted(record.get("files", {}).items()):
            path = _member(Path(directory), name)
            result.append(self._ticket(key, path, descriptor, name))
        return result


def _installed_module(application, relative):
    path = application / relative
    if not path.is_file():
        raise ValueError("The maintained application component is missing: " + relative)
    module_name = "_upstate_native_" + _sha(path)[:24]
    module = sys.modules.get(module_name)
    if module is None:
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ValueError("The maintained component cannot be loaded: " + relative)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    return module


def _provider(application, workspace):
    module = _installed_module(application, "operator/watershed_context.py")
    if "watershed.context.export" not in module.ACTIONS:
        raise ValueError("The current watershed selection exporter is required")
    host = NativeWorkspaceHost(workspace)
    return module.WatershedContextActions(host, ReceivingFault), host


def _model_input_fingerprint(edition, inputs=None):
    # A completed report retains the two or three files from its own invocation.
    # Later scientific companions in the same edition do not change that run.
    if inputs is None:
        names = ["full-domain-water-context.json", "scdes-domain217-source-coverage.json"]
        networks = [name for name in ("native-network.json", "native-network.json.gz")
                    if (edition / name).is_file()]
        if len(networks) > 1:
            raise ValueError("Choose one original native network encoding for this receiving edition")
        names += networks
        rows = [{"id": name, "sha256": _sha(_member(edition, name))} for name in sorted(names)]
    else:
        allowed = {"full-domain-water-context.json", "scdes-domain217-source-coverage.json",
                   "native-network.json", "native-network.json.gz"}
        names = [row.get("id") for row in inputs]
        if (len(names) != len(set(names)) or not set(names) <= allowed
                or not {"full-domain-water-context.json", "scdes-domain217-source-coverage.json"} <= set(names)
                or len(names) not in (2, 3)):
            raise ValueError("The completed report must retain its exact two or three model inputs")
        rows = []
        for row in sorted(inputs, key=lambda value: value["id"]):
            name = row["id"]
            actual = _sha(_member(edition, name))
            if actual != row["sha256"]:
                raise ValueError("The completed report input differs from the imported original: " + name)
            rows.append({"id": name, "sha256": actual})
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

def _source_inventory(workspace, collection_id):
    collection = workspace._get("sources", collection_id)
    result = {}
    for item in collection["entries"]:
        primary, entry = workspace.source_file(collection_id, item["id"])
        primary_name = entry["body"].get("view_path", entry["body"]["filename"])
        relative = Path(primary_name)
        root = primary
        for _part in relative.parts:
            root = root.parent
        rows = [_checked_file(root, body) for body in [entry["body"]] + entry["companions"]]
        result[entry["id"]] = {
            "primary": primary_name, "files": sorted(rows, key=lambda value: value["path"]),
            "source": {key: entry[key] for key in ("id", "title", "kind", "uri", "vintage", "metadata")
                       if key in entry},
        }
    return result


def _download_inventory(value):
    return sorted(
        ({key: row[key] for key in ("filename", "bytes", "sha256")} for row in value["_downloads"]),
        key=lambda row: row["filename"],
    )


def _application_sources(application):
    names = [
        "model/workspace.py", "model/portable.py", "model/watershed_context.py",
        "operator/watershed_context.py", "operator/receive_watershed_context.py",
        "model/watershed_brief.py", "source_tools/prepare_watershed_context.py",
        "source_tools/watershed_source_validation.py", "source_tools/watershed_source_entry.py",
        "source_tools/receive_watershed_context.py",
        "source_tools/receive_watershed_edition.py",
    ]
    return [_file(application / name, name=name) for name in names if (application / name).is_file()]


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True, help="Maintained original application root")
    parser.add_argument("--manifest", type=Path, required=True, help="Complete retained watershed edition manifest")
    parser.add_argument("--output", type=Path, required=True, help="Receiving directory; rerun the same command to continue")
    parser.add_argument("--workspace", type=Path, help="Existing Workspace; otherwise create output/workspace")
    parser.add_argument("--source-id", default=CONTEXT_SOURCE)
    parser.add_argument("--receipt-member", default=RECEIPT_MEMBER)
    parser.add_argument("--archive", type=Path, help="Original completed-run ZIP; otherwise use its retained source companion")
    parser.add_argument("--archive-member", default=ARCHIVE_MEMBER)
    parser.add_argument("--archive-sha256", default=ARCHIVE_SHA256)
    parser.add_argument("--carrier-file-id", default="F0C9JNBA7EU")
    parser.add_argument("--huc12", action="append", help="Watershed selection; defaults to the retained original selection")
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)
    application = args.application.resolve(strict=True)
    manifest = args.manifest.resolve(strict=True)
    if not (application / "model/workspace.py").is_file():
        raise ValueError("--application must select the original Upper Savannah application")
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model import portable
    from model.common import atomic_json, digest, now, held

    document = _json(manifest)
    if document.get("schema") != "upstate.sources/v1":
        raise ValueError("--manifest must select an ordinary upstate.sources/v1 edition")
    if sum(row.get("id") == args.source_id for row in document.get("entries", [])) != 1:
        raise ValueError("The selected context source ID must occur exactly once in the manifest")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    workspace_root = args.workspace.resolve(strict=True) if args.workspace else output / "workspace"
    if output.is_relative_to(workspace_root) or output.is_relative_to(application):
        raise ValueError("Choose a receiving output directory outside the source application and existing Workspace")
    request = {
        "application": str(application), "manifest_sha256": _sha(manifest),
        "workspace": str(workspace_root), "source_id": args.source_id,
        "receipt_member": args.receipt_member, "archive_member": args.archive_member,
        "archive_sha256": args.archive_sha256, "carrier_file_id": args.carrier_file_id,
        "selected_huc12s": sorted(set(args.huc12)) if args.huc12 else None,
    }
    request_sha = digest(request)
    receipt_path = output / "receiving-result.json"

    # A continued command owns only this receiving directory, never another run.
    with held(output / ".receiving.lock", blocking=False):
        receipt = _json(receipt_path) if receipt_path.exists() else {
            "schema": SCHEMA, "request": request, "request_sha256": request_sha,
            "started_at": now(), "phases": {},
        }
        if receipt.get("schema") != SCHEMA or receipt.get("request_sha256") != request_sha:
            raise ValueError("This receiving directory belongs to a different source or command")
        if digest(receipt["request"]) != request_sha:
            raise ValueError("The retained receiving request changed")

        def checkpoint(name, **data):
            receipt["phases"][name] = data
            receipt["updated_at"] = now()
            atomic_json(receipt_path, receipt)
            print(json.dumps({"phase": name, **{
                key: value for key, value in data.items()
                if value is None or isinstance(value, (str, int, float, bool))
            }}, ensure_ascii=False), flush=True)

        atomic_json(receipt_path, receipt)
        workspace = Workspace(workspace_root, create=not (workspace_root / "workspace.json").is_file(),
                              title="Upper Savannah retained watershed receiving")
        before = receipt["phases"].get("source_import")
        if before:
            if before["project_id"] != workspace.project["id"]:
                raise ValueError("The receiving Workspace identity changed")
            collection = workspace._get("sources", before["source_collection_id"])
        else:
            collection = workspace.import_sources(manifest)
        collection_id = collection["id"]
        source_inventory = _source_inventory(workspace, collection_id)
        if before and before["inventory"] != source_inventory:
            raise ValueError("The imported source edition changed after receiving")
        checkpoint("source_import", project_id=workspace.project["id"],
                   source_collection_id=collection_id, source_count=len(source_inventory),
                   file_references=sum(len(row["files"]) for row in source_inventory.values()),
                   inventory=source_inventory)

        primary, context_entry = workspace.source_file(collection_id, args.source_id)
        edition = primary.parent
        original_receipt_path = _member(edition, args.receipt_member)
        original_receipt = _json(original_receipt_path)
        if original_receipt.get("returncode") != 0:
            raise ValueError("The selected original watershed run did not complete successfully")
        expected_id = original_receipt["result"]["id"]
        native_operation_id = original_receipt.get("operation_id")
        if not isinstance(native_operation_id, str) or not native_operation_id:
            raise ValueError("The original native operation identity is missing from its retained receipt")
        selection_path = _member(original_receipt_path.parent, "selected-watersheds.json")
        original_selection = _json(selection_path)
        selected = sorted(set(args.huc12 or original_selection["selected_huc12s"]))
        if not selected or any(not isinstance(value, str) or len(value) != 12 or not value.isdigit()
                               for value in selected):
            raise ValueError("Select complete 12-digit original watershed identifiers")
        provider, host = _provider(application, workspace)
        operation_id = digest({"request": request_sha, "project_id": workspace.project["id"],
                               "source_collection_id": collection_id})
        original_archive = args.archive.resolve(strict=True) if args.archive else _member(edition, args.archive_member)
        if original_archive.is_symlink() or not original_archive.is_file() or _sha(original_archive) != args.archive_sha256:
            raise ValueError("The original completed-run ZIP differs from its retained archive identity")
        receiver = _installed_module(application, "source_tools/receive_watershed_context.py")
        received_record = receiver.receive_completed(
            workspace, original_archive, expected_sha256=args.archive_sha256)
        result = {
            "schema": "upstate.received-watershed-result/v1",
            "id": received_record["id"], "state": received_record["state"],
            "workspace": str(workspace.root),
            "directory": str(workspace.root / "watershed-context" / received_record["id"]),
            "archive_sha256": args.archive_sha256, "carrier_file_id": args.carrier_file_id,
            "native_operation_id": native_operation_id,
        }
        if result["id"] != expected_id:
            raise ValueError("Receiving changed the completed original result identity")
        report = provider.read(host.key, "report", {"report_id": result["id"]})
        if report["report"]["id"] != expected_id:
            raise ValueError("The retained original model report and operator identity differ")
        if report["source_fingerprint"] != _model_input_fingerprint(edition, report["source_inputs"]):
            raise ValueError("The received report must retain the maintained loader model-input fingerprint")
        report_files = _download_inventory(report)
        for name, expected in original_receipt["result"]["files"].items():
            actual = next((row for row in report_files if row["filename"] == name), None)
            if actual is None or actual["bytes"] != expected["bytes"] or actual["sha256"] != expected["sha256"]:
                raise ValueError("The received report output differs from its original run: " + name)
        detail = [provider.read(host.key, "huc", {"report_id": result["id"], "huc12": value})
                  for value in selected]
        checkpoint("completed_report", report_id=result["id"], operation_id=operation_id,
                   native_operation_id=native_operation_id,
                   summary=report["report"]["summary"], original_run_receipt=_file(original_receipt_path),
                   original_archive=_file(original_archive), receiving_result=result,
                   files=report_files, selected_huc12s=selected, selected_records=detail)

        exported = provider.invoke({
            "id": digest({"operation_id": operation_id, "export": selected}),
            "action": "watershed.context.export", "workspace": host.key,
            "created_at": receipt["started_at"], "payload": {"report_id": result["id"], "huc12s": selected},
        })
        export = provider.read(host.key, "export", {"export_id": exported["id"]})
        export_files = _download_inventory(export)
        checkpoint("selection_export", export_id=exported["id"], report_id=result["id"],
                   selected_huc12s=selected, files=export_files, downloads=export["_downloads"])

        # Keep the received native result and the current source analysis as
        # separate saved reports; both belong to this same imported Workspace.
        current_result = provider.invoke({
            "id": digest({"operation_id": operation_id, "analyze": collection_id, "selected": selected}),
            "action": "watershed.context.analyze", "workspace": host.key,
            "created_at": receipt["started_at"], "payload": {
                "title": "Upper Savannah current regional source and native network",
                "selection": {"source_collection_id": collection_id, "source_id": args.source_id},
                "huc12s": selected,
            },
        })
        current_report = provider.read(host.key, "report", {"report_id": current_result["id"]})
        if current_report["source_fingerprint"] != _model_input_fingerprint(edition):
            raise ValueError("The current analysis does not use the imported edition's exact model inputs")
        current_files = _download_inventory(current_report)
        current_detail = [provider.read(host.key, "huc", {
            "report_id": current_result["id"], "huc12": value}) for value in selected]
        current_exported = provider.invoke({
            "id": digest({"operation_id": operation_id, "current_export": selected,
                          "report_id": current_result["id"]}),
            "action": "watershed.context.export", "workspace": host.key,
            "created_at": receipt["started_at"], "payload": {
                "report_id": current_result["id"], "huc12s": selected},
        })
        current_export = provider.read(host.key, "export", {"export_id": current_exported["id"]})
        current_export_files = _download_inventory(current_export)
        checkpoint("current_source_analysis", report_id=current_result["id"],
                   source_fingerprint=current_report["source_fingerprint"],
                   completed_report_id=result["id"], files=current_files,
                   selected_huc12s=selected, selected_records=current_detail,
                   source_validation=current_report.get("source_validation"),
                   export_id=current_exported["id"], export_files=current_export_files,
                   downloads=current_export["_downloads"])

        archive = output / "watershed-workspace-current-sources.zip"
        backup_phase = receipt["phases"].get("backup_current_sources")
        if backup_phase:
            actual = _file(archive)
            if actual["bytes"] != backup_phase["archive"]["bytes"] or actual["sha256"] != backup_phase["archive"]["sha256"]:
                raise ValueError("The retained Workspace archive changed")
        elif archive.exists():
            # An interrupted backup may have finished before the checkpoint.
            # Preserve that file and reopen it through the original restore engine.
            checkpoint("backup_current_sources", archive=_file(archive), resumed_existing_archive=True,
                       application_sources=_application_sources(application))
        else:
            backup_result = portable.backup(workspace, archive)
            checkpoint("backup_current_sources", archive=_file(archive), result=backup_result,
                       application_sources=_application_sources(application))

        destination = output / "reopened-current-sources"
        if not destination.exists():
            restored = portable.restore(archive, destination)
            checkpoint("restore_current_sources", destination=str(destination), result=restored)
        elif not (destination / "workspace/workspace.json").is_file():
            raise ValueError("A previous restore left an incomplete destination; preserve it and select a new output directory")
        reopened = Workspace(destination / "workspace")
        if reopened.project["id"] != workspace.project["id"]:
            raise ValueError("The restored Workspace has a different project identity")
        reopened_inventory = _source_inventory(reopened, collection_id)
        if reopened_inventory != source_inventory:
            raise ValueError("The restored original primary files or companions differ")
        restored_application = destination / "application"
        reopened_provider, reopened_host = _provider(restored_application, reopened)
        reopened_report = reopened_provider.read(reopened_host.key, "report", {"report_id": result["id"]})
        reopened_export = reopened_provider.read(reopened_host.key, "export", {"export_id": exported["id"]})
        if _download_inventory(reopened_report) != report_files:
            raise ValueError("The reopened original report files differ")
        if _download_inventory(reopened_export) != export_files:
            raise ValueError("The reopened selected-watershed export differs")
        reopened_detail = [reopened_provider.read(reopened_host.key, "huc", {
            "report_id": result["id"], "huc12": value}) for value in selected]
        if reopened_detail != detail:
            raise ValueError("The original selected watershed records changed after reopen")
        reopened_current = reopened_provider.read(reopened_host.key, "report", {
            "report_id": current_result["id"]})
        reopened_current_export = reopened_provider.read(reopened_host.key, "export", {
            "export_id": current_exported["id"]})
        if _download_inventory(reopened_current) != current_files:
            raise ValueError("The reopened current source analysis files differ")
        if _download_inventory(reopened_current_export) != current_export_files:
            raise ValueError("The reopened current source selection and planning briefs differ")
        if reopened_current["source_fingerprint"] != current_report["source_fingerprint"]:
            raise ValueError("The reopened current source analysis identity differs")
        reopened_current_detail = [reopened_provider.read(reopened_host.key, "huc", {
            "report_id": current_result["id"], "huc12": value}) for value in selected]
        if reopened_current_detail != current_detail:
            raise ValueError("The current selected watershed records changed after reopen")
        source_before = receipt["phases"]["backup_current_sources"]["application_sources"]
        source_after = _application_sources(restored_application)
        if source_after != source_before:
            raise ValueError("The restored receiving application source differs")
        checkpoint("reopen", project_id=reopened.project["id"], source_collection_id=collection_id,
                   report_id=result["id"], export_id=exported["id"], selected_huc12s=selected,
                   source_count=len(reopened_inventory), original_companions_preserved=True,
                   completed_outputs_preserved=True, selection_preserved=True,
                   current_analysis_id=current_result["id"],
                   current_export_id=current_exported["id"], current_analysis_preserved=True,
                   application_sources_preserved=True)
        checkpoint("complete", completed_at=now(), result_path=str(receipt_path),
                   archive=str(archive), received_workspace=str(reopened.root))
    return receipt


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "failed", "error_type": type(error).__name__,
                          "error": str(error), "code": getattr(error, "code", None)}),
              file=sys.stderr, flush=True)
        raise
