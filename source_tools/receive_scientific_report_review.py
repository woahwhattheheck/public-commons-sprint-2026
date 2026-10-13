"""Receive a saved scientific edition through Customer review and full restore.

Select an actual completed edition and explicit review questions. The command
retains one creation timestamp and real response generation, exports the original
review package, backs up the entire Workspace, restores a separate copy and joins
that same review package through the existing receiving API.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model import portable, reviews, scientific_report_editions, scientific_report_review
from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, now, read_json, verify_file
from model.workspace import Workspace

SCHEMA = "upstate.scientific-report-review-receiving/v1"
EDITION = "scientific-report-review-receiving-20261013-v1"


def _event(stage, **details):
    print(json.dumps({"stage": stage, **details}, ensure_ascii=False,
                     sort_keys=True, allow_nan=False), file=sys.stderr, flush=True)


def _ordinary(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Choose an original ordinary file: " + str(path))
    return path


def _clean_review(value):
    result = deepcopy(value)
    for artifact in result["artifacts"]:
        artifact.pop("preview", None)
    return result


def _verified_packet(path, review, generation):
    inspected = reviews.inspect_packet(path)
    packet = inspected["packet"]
    if (_clean_review(packet["review"]) != review
            or [row["id"] for row in packet["responses"]] != generation["response_ids"]
            or packet["latest_response_id"] != generation["through_response_id"]):
        raise ValueError("The review package differs from the selected request or response generation")
    return inspected


def _verify_source(workspace, created):
    descriptor = created["source_receipt"]
    receipt = read_json(verify_file(workspace.root, descriptor))
    identity = created["source_identity"]
    if (receipt["source_identity"] != identity
            or receipt["source_collection_id"] != created["source_collection_id"]
            or receipt["source_id"] != created["source_id"]):
        raise ValueError("The original report review source receipt changed")
    for row in receipt["files"]:
        verify_file(workspace.root, row)
    collection = workspace._get("sources", created["source_collection_id"])
    if digest(collection) != receipt["source_collection_sha256"]:
        raise ValueError("The complete original review source collection changed")
    primary, entry = workspace.source_file(
        created["source_collection_id"], created["source_id"])
    if (entry.get("role") != scientific_report_review.ROLE
            or entry.get("metadata", {}).get("scientific_report_identity") != identity):
        raise ValueError("The review source identifies another scientific report")
    body = entry["body"]
    if primary.stat().st_size != body["bytes"] or file_digest(primary) != body["sha256"]:
        raise ValueError("The original report HTML differs from its source body")
    body_name = body.get("view_path", body["filename"])
    prefix = "report/" if body_name == "report/" + identity["primary_path"] else ""
    actual = {}
    for row in [body, *entry.get("companions", [])]:
        name = row.get("view_path", row["filename"])
        if name in actual:
            raise ValueError("The original report source repeats a member path")
        actual[name] = {key: row[key] for key in ("bytes", "sha256")}
    expected = {prefix + row["path"]: {key: row[key] for key in ("bytes", "sha256")}
                for row in identity["members"]}
    if actual != expected or body_name != prefix + identity["primary_path"]:
        raise ValueError("The complete relative report tree changed during receiving")
    return {"source_collection_id": created["source_collection_id"],
            "source_id": created["source_id"],
            "source_collection_sha256": receipt["source_collection_sha256"],
            "primary_path": body_name, "member_count": len(actual),
            "member_identity_sha256": digest(actual)}


def _reopen(workspace, edition_id, draft, preview, created, review, generation):
    actual_preview = scientific_report_review.preview_review(workspace, edition_id, draft)
    if actual_preview != preview:
        raise ValueError("Reopening changed the original scientific report or review preview")
    packet = reviews.show_review(workspace, created["review_id"], previews=False)
    if (_clean_review(packet["review"]) != review
            or packet["review"]["selection"] != created["review_selection"]
            or len(packet["review"]["artifacts"]) != created["artifact_count"]):
        raise ValueError("The reopened review changed its original selection or artifacts")
    selected = reviews.response_prefix(packet["responses"], generation["through_response_id"])
    if [row["id"] for row in selected] != generation["response_ids"]:
        raise ValueError("The selected original response prefix changed")
    source = _verify_source(workspace, created)
    if source["member_count"] != created["source_member_count"]:
        raise ValueError("The report source lost an original file")
    return {"review_id": created["review_id"], "source": source,
            "scientific_report_edition_id": edition_id,
            "review_sha256": digest(review), "files": packet["files"],
            "selected_response_ids": generation["response_ids"],
            "through_response_id": generation["through_response_id"],
            "source_identity": created["source_identity"]}



def _pending_archive(path, inspect, validate):
    """Adopt a complete owned staging ZIP or clear its interrupted partial body."""
    if not path.exists() and not path.is_symlink():
        return False
    _ordinary(path)
    try:
        inspected = inspect(path)
    except (zipfile.BadZipFile, EOFError, ValueError, KeyError, json.JSONDecodeError):
        # Caller holds both the retained operation lock and external output lock.
        # This exact staging filename is generated only for this owned operation.
        path.unlink()
        _event("removed-interrupted-staging", path=str(path))
        return False
    validate(inspected)
    return True


def _retain_package_controls(directory, retained, review, generation):
    inspected = _verified_packet(directory, review, generation)
    root = retained / "package-controls"
    marker = root / "controls.json"
    artifact_paths = {row["path"] for row in review["artifacts"]}
    names = sorted(set(inspected["manifest"]["members"]) - artifact_paths)
    names.append("review-manifest.json")
    expected = {"schema": SCHEMA + "/package-controls",
                "package_sha256": inspected["manifest"]["package_sha256"],
                "review_id": review["id"], "generation": generation,
                "files": [describe_file(directory, directory / name) for name in names]}
    if marker.is_file():
        if read_json(marker) != expected:
            raise ValueError("The original retained review package controls changed")
        for row in expected["files"]:
            verify_file(root, row)
        return root, expected
    root.mkdir(parents=True, exist_ok=True)
    # Until the complete controls marker exists, these are uncommitted copies
    # of the verified original external package and can be completed on retry.
    for row in expected["files"]:
        source = verify_file(directory, row)
        atomic_bytes(root / row["path"], source.read_bytes())
        verify_file(root, row)
    atomic_json(marker, expected, immutable=True)
    return root, expected


def _restore_package_controls(workspace, directory, retained, review, generation):
    root = retained / "package-controls"
    marker = root / "controls.json"
    if not marker.is_file():
        return False
    controls = read_json(marker)
    if (controls.get("schema") != SCHEMA + "/package-controls"
            or controls["review_id"] != review["id"]
            or controls["generation"] != generation):
        raise ValueError("The retained package controls identify another review generation")
    for row in controls["files"]:
        verify_file(root, row)
    directory.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".review-rebuild-", dir=directory.parent))
    try:
        for artifact in review["artifacts"]:
            original, selected = reviews.review_file(workspace, review["id"], artifact["id"])
            if selected != artifact:
                raise ValueError("The retained artifact locator changed during package reconstruction")
            target = pending / artifact["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            verify_file(pending, {"path": artifact["path"], "bytes": artifact["bytes"],
                                  "sha256": artifact["sha256"]})
        for row in controls["files"]:
            atomic_bytes(pending / row["path"], verify_file(root, row).read_bytes(), immutable=True)
        inspected = _verified_packet(pending, review, generation)
        if inspected["manifest"]["package_sha256"] != controls["package_sha256"]:
            raise ValueError("Reconstruction changed the original review package")
        if directory.exists() or directory.is_symlink():
            raise ValueError("The original package destination appeared during reconstruction")
        os.rename(pending, directory)
        pending = None
    finally:
        if pending is not None:
            shutil.rmtree(pending)
    return True


def _archive(workspace, operation, retained):
    path = operation / "complete-workspace.zip"
    receipt_path = operation / "workspace-archive.json"
    if receipt_path.is_file():
        result = read_json(receipt_path)
        _ordinary(path)
        if (result["project_id"] != workspace.project["id"]
                or path.stat().st_size != result["bytes"]
                or file_digest(path) != result["sha256"]):
            raise ValueError("The completed Workspace archive differs from its receipt")
        return result
    def validate(manifest):
        if manifest["project"] != workspace.project:
            raise ValueError("The existing archive identifies another original project")
        for original in sorted(retained.rglob("*")):
            if not original.is_file() or original.name.endswith(".lock"):
                continue
            name = "workspace/" + original.relative_to(workspace.root).as_posix()
            expected = manifest["members"].get(name)
            if not expected or any(expected[key] != describe_file(retained, original)[key]
                                   for key in ("bytes", "sha256")):
                raise ValueError("The existing archive omits an original receiving record: " + name)
    pending = operation / (".archive-" + path.name + ".pending")
    if not path.exists() and not path.is_symlink():
        if _pending_archive(pending, lambda value: portable.inspect_archive(value, verify=True), validate):
            os.link(pending, path)
            pending.unlink()
    if path.exists() or path.is_symlink():
        _ordinary(path)
        manifest = portable.inspect_archive(path, verify=True)
        validate(manifest)
        result = {"project_id": workspace.project["id"], "path": str(path),
                  "bytes": path.stat().st_size, "sha256": file_digest(path),
                  "members": len(manifest["members"]), "selection": manifest["selection"],
                  "recovered_published_archive": True}
    else:
        result = portable.backup(workspace, path,
                                 include_intermediates=True, include_deliveries=True)
    atomic_json(receipt_path, result, immutable=True)
    return result


def _restore(operation, archive, project):
    target = operation / "restored"
    receipt_path = operation / "workspace-restore.json"
    if target.is_symlink():
        raise ValueError("Keep the restored Workspace in its original ordinary directory")
    if not target.exists():
        if receipt_path.exists():
            raise ValueError("The original restored Workspace directory is missing")
        result = portable.restore(archive["path"], target)
        atomic_json(receipt_path, result, immutable=True)
    elif receipt_path.is_file():
        result = read_json(receipt_path)
    else:
        # Published restore is atomic; recover only after verifying every
        # original archived member against the directory left by that process.
        manifest = portable.inspect_archive(archive["path"], verify=False)
        for name, descriptor in manifest["members"].items():
            verify_file(target, {"path": name, **descriptor})
        result = {"workspace": str(target / "workspace"),
                  "application": str(target / "application"),
                  "archive_sha256": archive["sha256"],
                  "project": project, "recovered_published_restore": True}
        atomic_json(receipt_path, result, immutable=True)
    if (result["archive_sha256"] != archive["sha256"]
            or Path(result["workspace"]).resolve() != (target / "workspace").resolve()
            or result["project"] != project):
        raise ValueError("The restored copy differs from the selected complete archive")
    restored = Workspace(target / "workspace")
    if restored.project != project:
        raise ValueError("Receiving changed the original scientific project")
    return result, restored


def list_editions(workspace):
    rows = []
    for path in sorted((workspace.root / scientific_report_editions.KIND).glob("*/edition.json")):
        record, directory, _ = scientific_report_editions.inspect(workspace, path.parent.name)
        members = scientific_report_editions.files(record, directory)
        rows.append({"id": record["id"], "title": record["title"],
                     "source_count": record["source_count"],
                     "section_count": record["section_count"],
                     "figure_count": record["figure_count"],
                     "member_count": len({row["path"] for row in members.values()})})
    return rows


def receive(workspace_path, edition_id, review_selection, output, *, created_at=None):
    workspace = Workspace(Path(workspace_path).resolve())
    draft_path = _ordinary(Path(review_selection).resolve())
    draft = read_json(draft_path)
    preview = scientific_report_review.preview_review(workspace, edition_id, draft)
    requested_time = (reviews._date(created_at, "Review creation time")
                      if created_at is not None else None)
    identity = {"schema": SCHEMA, "edition": EDITION,
                "project_id": workspace.project["id"],
                "scientific_report_edition_id": edition_id,
                "review_preview_operation_id": preview["operation_id"],
                "review_selection": preview["review_selection"],
                "requested_created_at": requested_time,
                "consumer_source_sha256": {
                    module.__name__: file_digest(Path(module.__file__))
                    for module in (scientific_report_review, scientific_report_editions, reviews, portable)},
                "receiver_source_sha256": file_digest(Path(__file__))}
    operation_id = digest(identity)
    output = Path(output).resolve()
    if (output.is_relative_to(workspace.root.resolve())
            or output.is_relative_to(APPLICATION.resolve())):
        raise ValueError("Keep review exports and restored copies outside the original Workspace and application")
    operation = output / operation_id
    operation.mkdir(parents=True, exist_ok=True)
    retained = workspace.root / "scientific-report-review-receiving" / operation_id
    retained.mkdir(parents=True, exist_ok=True)
    with held(retained / "receiving.lock"), held(operation / "operation.lock"):
        atomic_json(operation / "identity.json", identity, immutable=True)
        atomic_json(retained / "identity.json", identity, immutable=True)
        atomic_json(retained / "review-selection.json", preview["review_selection"], immutable=True)
        atomic_json(retained / "preview.json", preview, immutable=True)
        request_path = operation / "request.json"
        retained_request = retained / "request.json"
        candidates = [read_json(path) for path in (retained_request, request_path) if path.is_file()]
        if candidates:
            request = candidates[0]
            if any(value != request for value in candidates[1:]):
                raise ValueError("The retained and external original review requests differ")
            if (request["operation_id"] != operation_id
                    or request["review_selection"] != preview["review_selection"]
                    or (requested_time is not None and request["created_at"] != requested_time)):
                raise ValueError("The original review request differs from this receiving operation")
            reviews._date(request["created_at"], "Review creation time")
        else:
            request = {"operation_id": operation_id,
                       "created_at": requested_time or now(),
                       "review_selection": preview["review_selection"]}
        atomic_json(retained_request, request, immutable=True)
        atomic_json(request_path, request, immutable=True)
        _event("prepare-original-review", operation_id=operation_id, edition_id=edition_id)
        created = scientific_report_review.create_review(
            workspace, edition_id, preview["review_selection"],
            expected_operation_id=preview["operation_id"], created_at=request["created_at"])
        atomic_json(retained / "created.json", created, immutable=True)
        current = reviews.show_review(workspace, created["review_id"], previews=False)
        review = _clean_review(current["review"])
        atomic_json(retained / "original-review.json", review, immutable=True)
        generation_path = retained / "response-generation.json"
        if generation_path.is_file():
            generation = read_json(generation_path)
        else:
            generation = {"through_response_id": current["latest_response_id"],
                          "response_ids": [row["id"] for row in current["responses"]]}
            atomic_json(generation_path, generation, immutable=True)
        reopened = _reopen(workspace, edition_id, preview["review_selection"],
                           preview, created, review, generation)
        atomic_json(retained / "reopened.json", reopened, immutable=True)

        _event("export-original-review", review_id=created["review_id"],
               through_response_id=generation["through_response_id"])
        directory = operation / "review-package"
        archive_path = operation / "review-package.zip"
        if directory.exists() or directory.is_symlink():
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError("Choose the original ordinary review package directory")
            _verified_packet(directory, review, generation)
        elif not _restore_package_controls(workspace, directory, retained, review, generation):
            reviews.export_review(workspace, created["review_id"], directory,
                                  through_response_id=generation["through_response_id"])
        _verified_packet(directory, review, generation)
        _retain_package_controls(directory, retained, review, generation)
        if not archive_path.exists() and not archive_path.is_symlink():
            pending_archive = operation / (".review-archive-" + archive_path.name + ".pending")
            def validate_pending(inspected):
                checked = _verified_packet(pending_archive, review, generation)
                if checked["manifest"]["package_sha256"] != reviews.inspect_packet(directory)["manifest"]["package_sha256"]:
                    raise ValueError("The staged archive identifies another original package")
            if _pending_archive(pending_archive, reviews.inspect_packet, validate_pending):
                os.link(pending_archive, archive_path)
                pending_archive.unlink()
            else:
                reviews.archive_packet(directory, archive_path)
        _ordinary(archive_path)
        _verified_packet(archive_path, review, generation)
        exported = reviews.describe_export(directory, archive=archive_path)
        export_identity = {"review_id": exported["review_id"],
                           "package_sha256": exported["package_sha256"],
                           "latest_response_id": exported["latest_response_id"],
                           "members": exported["members"],
                           "artifact_count": exported["artifact_count"]}
        atomic_json(operation / "review-export.json", exported, immutable=True)
        atomic_json(retained / "review-export.json", export_identity, immutable=True)

        _event("backup-complete-workspace", project_id=workspace.project["id"])
        archived = _archive(workspace, operation, retained)
        _event("restore-complete-workspace", archive_sha256=archived["sha256"])
        restored_receipt, restored = _restore(operation, archived, workspace.project)
        restored_retained = restored.root / retained.relative_to(workspace.root)
        for path in sorted(retained.rglob("*")):
            if path.is_file() and not path.name.endswith(".lock"):
                verify_file(restored_retained, describe_file(retained, path))
        restored_result = _reopen(
            restored, edition_id, preview["review_selection"],
            preview, created, review, generation)
        if restored_result != reopened:
            raise ValueError("Original and restored report/review source identities differ")

        _event("receive-original-review-package", review_id=created["review_id"])
        received_directory = operation / "received-review"
        received_receipt = operation / "review-receive.json"
        if received_directory.exists() or received_directory.is_symlink():
            if received_directory.is_symlink() or not received_directory.is_dir():
                raise ValueError("Choose the original ordinary received review directory")
            inspected = _verified_packet(received_directory, review, generation)
            if inspected["manifest"]["package_sha256"] != exported["package_sha256"]:
                raise ValueError("The received review package differs from its exported generation")
            joined = reviews.import_packet(restored, inspected["packet"])
            if received_receipt.is_file():
                received = read_json(received_receipt)
            else:
                received = {"schema": reviews.PACKAGE_SCHEMA,
                            "directory": str(received_directory),
                            "index": str(received_directory / "index.html"),
                            "review_id": created["review_id"],
                            "package_sha256": exported["package_sha256"], "joined": joined}
                atomic_json(received_receipt, received, immutable=True)
        else:
            if received_receipt.exists():
                raise ValueError("The retained received review directory is missing")
            received = reviews.receive_packet(archive_path, received_directory, workspace=restored)
            atomic_json(received_receipt, received, immutable=True)
        if (received["review_id"] != created["review_id"]
                or received["package_sha256"] != exported["package_sha256"]
                or (received.get("joined") or {}).get("review_id") != created["review_id"]):
            raise ValueError("The received review receipt identifies another original request")
        _verified_packet(received_directory, review, generation)
        final = _reopen(restored, edition_id, preview["review_selection"],
                        preview, created, review, generation)
        if final != reopened:
            raise ValueError("Joining the review package changed its original selected report")
        result = {
            "schema": SCHEMA + "/result", "state": "complete",
            "operation_id": operation_id, "identity": identity,
            "workspace": str(workspace.root), "project_id": workspace.project["id"],
            "scientific_report_edition_id": edition_id,
            "review_id": created["review_id"], "created_at": request["created_at"],
            "title": created["title"], "purpose": created["purpose"],
            "source_collection_id": created["source_collection_id"], "source_id": created["source_id"],
            "original_study_count": created["original_study_count"],
            "source_member_count": created["source_member_count"],
            "artifact_count": created["artifact_count"],
            "selected_response_generation": generation,
            "export": exported, "workspace_archive": archived,
            "restore": restored_receipt, "received_review": received,
            "restored_verification": final,
            "retained_directory": retained.relative_to(workspace.root).as_posix(),
            "receipt": str(operation / "result.json"),
        }
        atomic_json(operation / "result.json", result, immutable=True)
        _event("complete", review_id=created["review_id"], receipt=result["receipt"])
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--edition-id")
    parser.add_argument("--review-selection", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--created-at")
    parser.add_argument("--list", action="store_true", help="Inspect actual complete scientific editions")
    args = parser.parse_args(argv)
    if args.list:
        result = list_editions(Workspace(args.workspace.resolve()))
    else:
        if not args.edition_id or not args.review_selection or not args.output:
            parser.error("--edition-id, --review-selection and --output are required for receiving")
        result = receive(args.workspace, args.edition_id, args.review_selection, args.output,
                         created_at=args.created_at)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
