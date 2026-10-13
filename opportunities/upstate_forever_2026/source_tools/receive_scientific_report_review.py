"""Receive a saved scientific edition or complete pair through review and full restore.

Select an actual completed edition and explicit review questions. The command
retains one creation timestamp and real response generation, exports the original
review package, backs up the entire Workspace, restores a separate copy and joins
that same review package through the existing receiving API.
"""
from __future__ import annotations

import argparse
import hashlib
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
from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file
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


def _review_engine(comparison_id=None):
    if comparison_id is None:
        return scientific_report_review
    from model import report_changes_review
    return report_changes_review


def _review_target(identity):
    """Retain one scientific edition or one exact complete pair in native receipts."""
    if identity.get("schema") == scientific_report_review.SCHEMA:
        return {"scientific_report_edition_id": identifier(
            identity.get("scientific_report_edition_id"))}
    engine = _review_engine(identity.get("comparison_id"))
    if identity.get("schema") != engine.SCHEMA or engine is scientific_report_review:
        raise ValueError("Retain the original scientific report or comparison review identity")
    pair = identity.get("pair_identity")
    if not isinstance(pair, dict):
        raise ValueError("Retain both original scientific report fingerprints")
    editions = []
    for side in ("left", "right"):
        original = pair.get(side)
        if (not isinstance(original, dict)
                or original.get("project_id") != identity.get("project_id")):
            raise ValueError("The review pair belongs to another original project")
        editions.append(identifier(original.get("edition_id")))
    return {"comparison_id": identifier(identity.get("comparison_id")),
            "scientific_report_edition_ids": editions}


def _target_editions(target):
    return ([target["scientific_report_edition_id"]]
            if "scientific_report_edition_id" in target
            else target["scientific_report_edition_ids"])


def _verify_target(workspace, target, source_identity):
    if source_identity.get("project_id") != workspace.project["id"]:
        raise ValueError("The review target belongs to another scientific project")
    for edition_id in _target_editions(target):
        scientific_report_editions.inspect(workspace, edition_id)
    if "comparison_id" in target:
        context = _review_engine(target["comparison_id"]).comparison_context(
            workspace, target["comparison_id"])
        if context["identity"] != source_identity:
            raise ValueError("The original complete reviewed comparison changed")


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
    target = _review_target(identity)
    engine = _review_engine(target.get("comparison_id"))
    identity_field = ("scientific_report_comparison_identity" if "comparison_id" in target
                      else "scientific_report_identity")
    if (entry.get("role") != engine.ROLE
            or entry.get("metadata", {}).get(identity_field) != identity
            or any(created.get(name) != value for name, value in target.items()
                   if name != "scientific_report_edition_ids")):
        raise ValueError("The review source identifies another scientific report or pair")
    if "comparison_id" in target:
        engine.source_members(entry, identity)
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


def _verify_completed_capture(workspace, edition_id, proof):
    """Reopen the captured bytes using the saved edition, including after transfer."""
    from model import scientific_report_capture

    if (not isinstance(proof, dict) or proof.get("schema") != SCHEMA + "/completed-capture"
            or proof.get("project_id") != workspace.project["id"]
            or proof.get("scientific_report_edition_id") != edition_id):
        raise ValueError("The retained completed capture belongs to another report or project")
    record, directory, _ = scientific_report_editions.inspect(workspace, edition_id)
    if (record["render_identity"] != proof.get("render_identity")
            or record["files"] != proof.get("files")
            or record["operation_id"] != proof.get("operation_id")):
        raise ValueError("The saved edition differs from the exact captured report bytes")
    origin = proof.get("capture_origin")
    if not isinstance(origin, dict):
        raise ValueError("Retain the exact completed capture document")
    # The native origin verifier reads the embedded capture document and the
    # saved report files. A selected archive need not carry the donor directory.
    scientific_report_capture.verify_origin(
        workspace, {**record, "capture_origin": origin}, directory)
    members = {row["path"]: row for row in record["files"].values()}
    return {"capture_id": origin["capture_id"],
            "capture_sha256": origin["capture"]["sha256"],
            "scientific_report_edition_id": edition_id,
            "member_count": len(members),
            "member_identity_sha256": digest(members)}


def receive_capture(workspace_path, capture_id, capture_sha256, edition_id,
                    review_selection, output, *, created_at=None):
    """Adopt one explicitly pinned completed render before the original course."""
    from model import scientific_report_capture

    workspace = Workspace(Path(workspace_path).resolve())
    # Reject a missing/invalid authored request or unsafe output before adoption.
    draft = read_json(_ordinary(Path(review_selection).resolve()))
    if not isinstance(draft, dict):
        raise ValueError("Supply the actual review request as a JSON object")
    destination = Path(output).resolve()
    if (destination.is_relative_to(workspace.root.resolve())
            or destination.is_relative_to(APPLICATION.resolve())):
        raise ValueError("Keep review exports and restored copies outside the original Workspace and application")
    if created_at is not None:
        reviews._date(created_at, "Review creation time")
    value = scientific_report_capture._load(workspace, capture_id)
    if (value["edition_id"] != edition_id
            or value["capture_file"]["sha256"] != capture_sha256):
        raise ValueError("Review the exact completed capture ID, SHA256 and saved edition ID again")
    proof = {"schema": SCHEMA + "/completed-capture",
             "project_id": workspace.project["id"],
             "scientific_report_edition_id": edition_id,
             "operation_id": value["result"]["operation_id"],
             "render_identity": deepcopy(value["identity"]),
             "files": deepcopy(value["result"]["files"]),
             "capture_origin": {"schema": scientific_report_capture.ORIGIN_SCHEMA,
                 "capture_id": value["capture_id"],
                 "capture": {"content": value["capture_text"],
                             "bytes": value["capture_file"]["bytes"],
                             "sha256": value["capture_file"]["sha256"]}}}
    _event("adopt-completed-report", capture_id=capture_id, edition_id=edition_id,
           capture_sha256=capture_sha256)
    adopted = scientific_report_capture.adopt(
        workspace, capture_id, expected_capture_sha256=capture_sha256,
        expected_edition_id=edition_id)
    if (adopted.get("state") != "complete"
            or adopted.get("scientific_report_edition_id") != edition_id
            or adopted.get("capture_id") != capture_id):
        raise ValueError("The original adoption did not return the selected saved edition")
    _verify_completed_capture(workspace, edition_id, proof)
    return receive(workspace_path, edition_id, review_selection, output,
                   created_at=created_at, completed_capture=proof)


def _reopen(workspace, edition_id, draft, preview, created, review, generation,
            completed_capture=None, *, comparison_id=None):
    engine = _review_engine(comparison_id)
    actual_preview = engine.preview_review(
        workspace, comparison_id if comparison_id is not None else edition_id, draft)
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
    target = _review_target(created["source_identity"])
    result = {"review_id": created["review_id"], "source": source,
            **target,
            "review_sha256": digest(review), "files": packet["files"],
            "selected_response_ids": generation["response_ids"],
            "through_response_id": generation["through_response_id"],
            "source_identity": created["source_identity"]}
    if completed_capture is not None:
        result["completed_capture"] = _verify_completed_capture(
            workspace, edition_id, completed_capture)
    return result



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
        # The original restore may have published its complete receiving result
        # before this course retained the acknowledgement. Reconcile that same
        # archive and destination, including native registration and any later
        # receiver-only work; never restore over the existing directory.
        resume = getattr(portable, "resume_restore", None)
        if callable(resume):
            result = resume(archive["path"], target,
                            expected_archive_sha256=archive["sha256"])
        else:
            # Earlier applications have no receiving-completion protocol.
            # Admit their original output only after exact archived-byte checks.
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


def list_comparisons(workspace):
    from model import report_changes_review

    rows = []
    for path in sorted((workspace.root / report_changes_review.report_changes.KIND).glob("*/comparison.json")):
        if path.parent.name.startswith("."):
            continue
        context = report_changes_review.comparison_context(workspace, path.parent.name)
        record = context["record"]
        rows.append({"id": record["id"], "title": record["title"],
                     "project_id": workspace.project["id"],
                     "left_edition_id": record["identity"]["left"]["edition_id"],
                     "right_edition_id": record["identity"]["right"]["edition_id"],
                     "change_count": record["change_count"], "page_count": record["page_count"],
                     "member_count": len(context["members"]), "plan": deepcopy(record["plan"])})
    return rows


def receive(workspace_path, edition_id, review_selection, output, *, created_at=None,
            completed_capture=None, comparison_id=None):
    if (edition_id is None) == (comparison_id is None):
        raise ValueError("Select one saved scientific edition or one saved report comparison")
    if comparison_id is not None and completed_capture is not None:
        raise ValueError("Adopt the original editions before reviewing their saved comparison")
    workspace = Workspace(Path(workspace_path).resolve())
    draft_path = _ordinary(Path(review_selection).resolve())
    draft = read_json(draft_path)
    engine = _review_engine(comparison_id)
    preview = engine.preview_review(
        workspace, comparison_id if comparison_id is not None else edition_id, draft)
    target = _review_target(preview["source_identity"])
    requested_time = (reviews._date(created_at, "Review creation time")
                      if created_at is not None else None)
    identity = {"schema": SCHEMA, "edition": EDITION,
                "project_id": workspace.project["id"],
                **target,
                "review_preview_operation_id": preview["operation_id"],
                "review_selection": preview["review_selection"],
                "requested_created_at": requested_time,
                "consumer_source_sha256": {
                    module.__name__: file_digest(Path(module.__file__))
                    for module in (engine, scientific_report_editions, reviews, portable)},
                "receiver_source_sha256": file_digest(Path(__file__))}
    if comparison_id is not None:
        identity["consumer_source_sha256"][engine.report_changes.__name__] = file_digest(
            Path(engine.report_changes.__file__))
    if completed_capture is not None:
        from model import scientific_report_capture
        _verify_completed_capture(workspace, edition_id, completed_capture)
        identity["completed_capture"] = deepcopy(completed_capture)
        identity["consumer_source_sha256"][scientific_report_capture.__name__] = file_digest(
            Path(scientific_report_capture.__file__))
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
        _event("prepare-original-review", operation_id=operation_id,
               **({"edition_id": edition_id} if comparison_id is None else target))
        created = engine.create_review(
            workspace, comparison_id if comparison_id is not None else edition_id,
            preview["review_selection"],
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
                           preview, created, review, generation, completed_capture, comparison_id=comparison_id)
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
            preview, created, review, generation, completed_capture, comparison_id=comparison_id)
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
                        preview, created, review, generation, completed_capture, comparison_id=comparison_id)
        if final != reopened:
            raise ValueError("Joining the review package changed its original selected report")
        result = {
            "schema": SCHEMA + "/result", "state": "complete",
            "operation_id": operation_id, "identity": identity,
            "workspace": str(workspace.root), "project_id": workspace.project["id"],
            **target,
            "review_id": created["review_id"], "created_at": request["created_at"],
            "title": created["title"], "purpose": created["purpose"],
            "source_collection_id": created["source_collection_id"], "source_id": created["source_id"],
            **({"original_study_count": created["original_study_count"]}
               if "original_study_count" in created else {}),
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



def continue_selected_review(workspace_path, receipt_path, *, response_path=None):
    """Continue an existing completed course through the original Study exporter.

    A separately supplied response is imported only into the independent received
    Workspace. Existing original review requirements and customer decisions are
    never generated or rewritten by this receiving command.
    """
    from model import study_transfer

    workspace = Workspace(Path(workspace_path).resolve())
    receipt_path = _ordinary(Path(receipt_path).resolve())
    original = read_json(receipt_path)
    original_id = original.get("operation_id")
    if (original.get("schema") != SCHEMA + "/result" or original.get("state") != "complete"
            or digest(original.get("identity")) != original_id
            or original.get("project_id") != workspace.project["id"]
            or original["identity"].get("project_id") != workspace.project["id"]):
        raise ValueError("Continue the completed original scientific-report review receipt")
    retained = workspace.root / "scientific-report-review-receiving" / original_id
    if (original.get("retained_directory") != retained.relative_to(workspace.root).as_posix()
            or read_json(retained / "identity.json") != original["identity"]):
        raise ValueError("The original report receiving identity is not retained in this Workspace")
    created = read_json(retained / "created.json")
    review = read_json(retained / "original-review.json")
    target = _review_target(created["source_identity"])
    if (created["review_id"] != original["review_id"] or review["id"] != created["review_id"]
            or any(original.get(name) != value or original["identity"].get(name) != value
                   for name, value in target.items())
            or any(created.get(name) != value for name, value in target.items()
                   if name != "scientific_report_edition_ids")):
        raise ValueError("The completed course names another saved report, comparison or review")
    packet = reviews.show_review(workspace, review["id"], previews=False)
    if _clean_review(packet["review"]) != review:
        raise ValueError("The original saved review changed before editable transfer")
    source = _verify_source(workspace, created)
    edition_id = target.get("scientific_report_edition_id")
    comparison_id = target.get("comparison_id")
    _verify_target(workspace, target, created["source_identity"])
    completed_capture = original["identity"].get("completed_capture")
    if comparison_id is not None and completed_capture is not None:
        raise ValueError("A comparison review must retain both original saved report editions")
    capture_verification = (_verify_completed_capture(workspace, edition_id, completed_capture)
                            if completed_capture is not None else None)
    operation = receipt_path.parent / "selected-review"
    if (operation.resolve().is_relative_to(workspace.root.resolve())
            or operation.resolve().is_relative_to(APPLICATION.resolve())):
        raise ValueError("Keep selected review receiving outside the original Workspace and application")
    if operation.is_symlink() or operation.exists() and not operation.is_dir():
        raise ValueError("Keep selected review receiving in its original ordinary directory")
    operation.mkdir(parents=True, exist_ok=True)
    selection = {"schema": "upstate.study-selection/v1",
                 "title": review["title"] + " — editable customer review",
                 "roots": [{"kind": "reviews", "id": review["id"]}],
                 "include_related_results": True}
    identity = {"schema": SCHEMA + "/selected-review", "version": 1,
                "original_operation_id": original_id, "original_receipt": {
                    "bytes": receipt_path.stat().st_size, "sha256": file_digest(receipt_path)},
                "project_id": workspace.project["id"], "review_id": review["id"],
                **target, "selection": selection}
    with held(operation / "operation.lock"):
        atomic_json(operation / "identity.json", identity, immutable=True)
        _event("preview-selected-review", review_id=review["id"],
               **({"edition_id": edition_id} if comparison_id is None else target))
        archive_path = operation / "editable-review.zip"
        archive_receipt = operation / "study-export.json"
        if archive_receipt.is_file():
            archived = read_json(archive_receipt)
            if (Path(archived["path"]).resolve() != archive_path.resolve()
                    or _ordinary(archive_path).stat().st_size != archived["bytes"]
                    or file_digest(archive_path) != archived["sha256"]):
                raise ValueError("The retained selected-review archive changed")
        else:
            # The original exporter adopts its own already-published complete
            # archive after a lost response, using the exact immutable selection.
            if not archive_path.exists():
                preview = study_transfer.preview(workspace, selection)
                if not any(row["kind"] == "reviews" and row["id"] == review["id"]
                           for row in preview["nodes"]):
                    raise ValueError("Install the original Customer review Study transfer before continuing")
                atomic_json(operation / "study-preview.json", preview)
            _event("export-selected-review", review_id=review["id"])
            archived = study_transfer.export_study(workspace, archive_path, selection,
                progress=lambda value: _event("selected-review-progress", **value))
            atomic_json(archive_receipt, archived, immutable=True)
        checked = study_transfer.inspect_transfer_archive(archive_path, verify=True)
        captured = checked["study"]
        if (captured["id"] != archived["id"]
                or checked["manifest"]["project"] != workspace.project
                or captured["identity"]["selection"] != study_transfer.normalise(selection)):
            raise ValueError("The selected archive identifies another original review selection")
        required = {(row["kind"], row["id"]) for row in captured["identity"]["nodes"]}
        expected_nodes = {("reviews", review["id"]),
                          *(("scientific-report-editions", key) for key in _target_editions(target))}
        if comparison_id is not None:
            expected_nodes.add(("scientific-report-comparisons", comparison_id))
        if not expected_nodes.issubset(required):
            raise ValueError("The selected archive lost the original review, comparison or saved editions")
        snapshots = [row for row in captured["identity"].get("customer_reviews", [])
                     if row["id"] == review["id"]]
        if len(snapshots) != 1 or snapshots[0]["review_sha256"] != digest(review):
            raise ValueError("The selected archive lost its exact native customer-feedback receipt")
        snapshot = snapshots[0]
        if comparison_id is not None:
            links = [row for row in snapshot.get("report_comparisons", [])
                     if row["source_collection_id"] == created["source_collection_id"]
                     and row["source_id"] == created["source_id"]]
            if (len(links) != 1 or links[0].get("external")
                    or links[0].get("comparison_id") != comparison_id
                    or [links[0].get("left_edition_id"), links[0].get("right_edition_id")]
                       != target["scientific_report_edition_ids"]
                    or links[0].get("source_identity_sha256") != digest(created["source_identity"])):
                raise ValueError("The selected review lost its exact typed comparison source")
        _event("restore-selected-review", study_id=captured["id"])
        restored_receipt, restored = _restore(operation, archived, workspace.project)
        verification = study_transfer.verify_received_studies(restored)
        if captured["id"] not in {row["id"] for row in verification}:
            raise ValueError("The independent receiver did not reopen the selected review study")
        received = reviews.show_review(restored, review["id"], previews=False)
        if (_clean_review(received["review"]) != review
                or [row["id"] for row in received["responses"]][:len(snapshot["response_ids"])]
                != snapshot["response_ids"]
                or _verify_source(restored, created) != source):
            raise ValueError("The received selected review changed its original report or response prefix")
        _verify_target(restored, target, created["source_identity"])
        if (completed_capture is not None and _verify_completed_capture(
                restored, edition_id, completed_capture) != capture_verification):
            raise ValueError("The selected received report differs from its original completed capture")
        complete = {"schema": SCHEMA + "/selected-review-result", "state": "complete",
                    "identity": identity, "project_id": workspace.project["id"],
                    "review_id": review["id"], **target,
                    "study_id": captured["id"], "archive": archived, "restore": restored_receipt,
                    "captured_review": snapshot,
                    "report_source": source, "verification": verification,
                    "receipt": str(operation / "result.json")}
        if capture_verification is not None:
            complete["completed_capture"] = capture_verification
        result_path = operation / "result.json"
        if result_path.is_file():
            previous = read_json(result_path)
            # Additional received responses may advance logical verification.
            # Preserve the exact first receiving receipt rather than rewriting it.
            for name in ("schema", "state", "identity", "project_id", "review_id",
                         "scientific_report_edition_id", "comparison_id", "scientific_report_edition_ids",
                         "study_id", "archive", "restore",
                         "captured_review", "report_source", "completed_capture"):
                if previous.get(name) != complete.get(name):
                    raise ValueError("The original selected-review receiving result changed")
            complete = previous
        else:
            atomic_json(result_path, complete, immutable=True)
        if response_path is None:
            _event("selected-review-complete", study_id=captured["id"], receipt=str(result_path))
            return complete

        _event("receive-supplied-customer-response", review_id=review["id"])
        response_path = _ordinary(Path(response_path).resolve())
        raw = response_path.read_bytes()
        supplied = json.loads(raw)
        if (not isinstance(supplied, dict) or supplied.get("review_id") != review["id"]
                or supplied.get("project_id") != workspace.project["id"]):
            raise ValueError("Supply the actual response for this original review and project")
        checksum = hashlib.sha256(raw).hexdigest()
        if response_path.stat().st_size != len(raw) or file_digest(response_path) != checksum:
            raise ValueError("The supplied customer response changed while being received")
        response_directory = operation / "feedback" / checksum
        response_directory.mkdir(parents=True, exist_ok=True)
        atomic_bytes(response_directory / "original-response.json", raw, immutable=True)
        # Original import_response handles exact-request replay and predecessor
        # checks. A divergent reply must use the maintained reconciliation UI.
        imported = reviews.import_response(restored, supplied)
        atomic_json(response_directory / "imported-response.json", imported, immutable=True)
        verification = study_transfer.verify_received_studies(restored)
        current = reviews.history(restored, review["id"])
        if [row["id"] for row in current[:len(snapshot["response_ids"])]] != snapshot["response_ids"]:
            raise ValueError("The actual reply lost original captured customer decisions")
        if imported["id"] not in {row["id"] for row in current}:
            raise ValueError("The original customer-response importer did not retain the supplied reply")
        response_generation = reviews.response_prefix(current, imported["id"])
        returned = response_directory / "review-package"
        generation = {"through_response_id": imported["id"],
                      "response_ids": [row["id"] for row in response_generation]}
        if returned.exists() or returned.is_symlink():
            if returned.is_symlink() or not returned.is_dir():
                raise ValueError("Keep the returned review in its original ordinary package directory")
            _verified_packet(returned, review, generation)
        elif not _restore_package_controls(restored, returned, response_directory, review, generation):
            reviews.export_review(restored, review["id"], returned,
                                  through_response_id=imported["id"])
        _retain_package_controls(returned, response_directory, review, generation)
        archive = response_directory / "review-package.zip"
        if not archive.exists() and not archive.is_symlink():
            pending = response_directory / (".review-archive-" + archive.name + ".pending")
            if _pending_archive(pending, reviews.inspect_packet,
                    lambda unused: _verified_packet(pending, review, generation)):
                os.link(pending, archive)
                pending.unlink()
            else:
                reviews.archive_packet(returned, archive)
        _verified_packet(archive, review, generation)
        feedback = {"schema": SCHEMA + "/selected-review-feedback", "state": "complete",
                    "project_id": workspace.project["id"], "study_id": captured["id"],
                    "review_id": review["id"], "response_id": imported["id"],
                    "response_source": {"bytes": len(raw), "sha256": checksum},
                    "selected_review_receipt": str(result_path),
                    "restored_workspace": str(restored.root),
                    "export": reviews.describe_export(returned, archive=archive),
                    "verification": verification, "receipt": str(response_directory / "result.json")}
        feedback_path = response_directory / "result.json"
        if feedback_path.is_file():
            previous = read_json(feedback_path)
            for name in ("schema", "state", "project_id", "study_id", "review_id",
                         "response_id", "response_source", "export"):
                if previous.get(name) != feedback.get(name):
                    raise ValueError("The retained actual customer-response continuation changed")
            return previous
        atomic_json(feedback_path, feedback, immutable=True)
        _event("supplied-customer-response-complete", response_id=imported["id"],
               receipt=str(feedback_path))
        return feedback



def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--edition-id")
    parser.add_argument("--comparison-id", help="Exact saved complete report pair to review")
    parser.add_argument("--capture-id",
                        help="Exact completed original CLI capture to adopt before review")
    parser.add_argument("--capture-sha256",
                        help="Exact capture.json SHA256 returned by the original capture preview")
    parser.add_argument("--review-selection", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--created-at")
    parser.add_argument("--list", action="store_true", help="Inspect actual complete scientific editions")
    parser.add_argument("--list-comparisons", action="store_true",
                        help="Inspect complete local saved pairs without creating a review")
    parser.add_argument("--list-captures", action="store_true",
                        help="List original completed CLI captures without adoption or rendering")
    parser.add_argument("--selected-study", action="store_true",
                        help="Continue through selected editable review export and independent receiving")
    parser.add_argument("--continue-receipt", type=Path,
                        help="Continue an existing completed original result.json without recreating its course")
    parser.add_argument("--response", type=Path,
                        help="Actual returned customer response; import only into the selected received copy")
    args = parser.parse_args(argv)
    if args.list or args.list_captures or args.list_comparisons:
        if (sum((args.list, args.list_captures, args.list_comparisons)) != 1
                or args.selected_study or args.continue_receipt
                or args.response or args.capture_id or args.capture_sha256 or args.comparison_id):
            parser.error("Choose one read-only catalogue without a receiving or adoption request")
        workspace = Workspace(args.workspace.resolve())
        if args.list_captures:
            from model import scientific_report_capture
            result = scientific_report_capture.catalog(workspace)
        elif args.list_comparisons:
            result = list_comparisons(workspace)
        else:
            result = list_editions(workspace)
    elif args.continue_receipt:
        if (args.edition_id or args.comparison_id or args.review_selection or args.output or args.created_at
                or args.capture_id or args.capture_sha256):
            parser.error("--continue-receipt uses the exact retained review, selection and original output")
        result = continue_selected_review(args.workspace, args.continue_receipt,
                                          response_path=args.response)
    else:
        if (bool(args.edition_id) == bool(args.comparison_id)
                or not args.review_selection or not args.output):
            parser.error("Choose --edition-id or --comparison-id, with --review-selection and --output")
        if args.comparison_id and (args.capture_id or args.capture_sha256):
            parser.error("Adopt the original editions before choosing their saved comparison")
        if bool(args.capture_id) != bool(args.capture_sha256):
            parser.error("--capture-id and --capture-sha256 must pin the same completed original report")
        if args.response and not args.selected_study:
            parser.error("--response requires --selected-study or --continue-receipt")
        if args.capture_id:
            result = receive_capture(args.workspace, args.capture_id, args.capture_sha256,
                                     args.edition_id, args.review_selection, args.output,
                                     created_at=args.created_at)
        else:
            result = receive(args.workspace, args.edition_id, args.review_selection, args.output,
                             created_at=args.created_at, comparison_id=args.comparison_id)
        if args.selected_study:
            result = continue_selected_review(args.workspace, Path(result["receipt"]),
                                              response_path=args.response)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
