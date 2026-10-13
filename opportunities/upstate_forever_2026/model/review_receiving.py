"""Receive complete customer review packages into the original Workspace.

The incoming ZIP remains an immutable original.  A local operator desk renders
its retained review data through the maintained review application; received
HTML is never promoted to an authenticated application.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile

from .common import atomic_json, digest, file_digest, held, identifier, retain_file
from . import reviews

KIND = "review-receipts"
VIEW_KIND = "review-packet-views"
TEMPLATE = Path(__file__).resolve().parents[1] / "operator" / "review_app.html"
MANIFEST = "review-manifest.json"


def _descriptor(value, *, object_file=False):
    if not isinstance(value, dict) or type(value.get("bytes")) is not int or value["bytes"] < 0:
        raise ValueError("The received package needs its original file identity")
    checksum = identifier(value.get("sha256"))
    if object_file and value.get("object") != "objects/" + checksum:
        raise ValueError("The received archive leaves its canonical original object")
    return value


def record(workspace, receipt_id):
    row = workspace._get(KIND, identifier(receipt_id))
    if row.get("schema") != "upstate." + KIND + "/v1" or row.get("project_id") != workspace.project["id"]:
        raise ValueError("Open this received review in its original scientific project")
    identifier(row["review_id"])
    identifier(row["package_sha256"])
    identifier(row["upload_id"])
    _descriptor(row["archive"], object_file=True)
    _descriptor(row["original_manifest"])
    if row["incoming_response_id"] is not None:
        identifier(row["incoming_response_id"])
    if not isinstance(row["operation_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", row["operation_id"]):
        raise ValueError("The received review has no original operation identity")
    return row


def summary(row):
    result = {key: row[key] for key in (
        "id", "review_id", "title", "purpose", "received_at", "package_created_at",
        "package_sha256", "incoming_response_id", "response_count", "artifacts",
        "requirements", "members",
    )}
    result.update(archive_bytes=row["archive"]["bytes"], filename=row["archive"]["filename"])
    return result


def list_receipts(workspace, review_id=None):
    if review_id is not None:
        identifier(review_id)
    rows = [record(workspace, row["id"]) for row in workspace._list(KIND)
            if review_id is None or row.get("review_id") == review_id]
    return sorted((summary(row) for row in rows),
                  key=lambda row: (row["received_at"], row["id"]), reverse=True)


def archive_file(workspace, receipt_id, *, verify=True):
    row = record(workspace, receipt_id)
    descriptor = row["archive"]
    path = reviews._regular(workspace.root, descriptor["object"])
    if path.stat().st_size != descriptor["bytes"] or (verify and file_digest(path) != descriptor["sha256"]):
        raise ValueError("The original received review archive changed")
    return path, row


def inspect_received(workspace, receipt_id):
    path, row = archive_file(workspace, receipt_id)
    inspected = reviews.inspect_packet(path)
    manifest, packet = inspected["manifest"], inspected["packet"]
    if (manifest["package_sha256"] != row["package_sha256"]
            or manifest["project_id"] != row["project_id"]
            or manifest["review_id"] != row["review_id"]
            or manifest["response_ids"] != row["response_ids"]
            or packet["latest_response_id"] != row["incoming_response_id"]):
        raise ValueError("The received package differs from its retained original edition")
    return row, inspected


def receive(workspace, path, *, sha256, filename, upload_id, operation_id,
            received_at, expected_review_id=None):
    """Retain the original archive and join only its compatible original history."""
    identifier(sha256)
    identifier(upload_id)
    if not isinstance(operation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id):
        raise ValueError("Receive using the original queued operation identity")
    received_at = reviews._date(received_at)
    filename = reviews._text(filename, "original review filename", maximum=500)
    if not filename or "/" in filename or "\\" in filename:
        raise ValueError("Retain the original review archive filename")
    if expected_review_id is not None:
        identifier(expected_review_id)
    # Inspection uses the independent retained copy.  Input bytes cannot change
    # between the complete inventory check and publication of the receipt.
    original = retain_file(workspace.root, path, sha256)
    original["filename"] = filename
    archive = reviews._regular(workspace.root, original["object"])
    inspected = reviews.inspect_packet(archive)
    manifest, packet = inspected["manifest"], inspected["packet"]
    if manifest["project_id"] != workspace.project["id"]:
        raise ValueError("Receive this review package into its actual restored scientific project")
    if expected_review_id is not None and manifest["review_id"] != expected_review_id:
        raise ValueError("The received package belongs to another selected review")
    incoming = packet["responses"][-1]["id"] if packet["responses"] else None
    if packet.get("latest_response_id") != incoming:
        raise ValueError("The received package names a different original response generation")
    with zipfile.ZipFile(archive) as zipped:
        manifest_body = zipped.read(MANIFEST)
    descriptor = {"bytes": len(manifest_body), "sha256": hashlib.sha256(manifest_body).hexdigest()}
    payload = {
        "project_id": workspace.project["id"], "review_id": manifest["review_id"],
        "upload_id": upload_id, "operation_id": operation_id,
        "expected_review_id": expected_review_id, "received_at": received_at,
        "package_created_at": manifest["created_at"], "package_sha256": manifest["package_sha256"],
        "archive": original, "original_manifest": descriptor,
        "incoming_response_id": incoming, "response_ids": manifest["response_ids"],
        "response_count": len(packet["responses"]), "title": packet["review"]["title"],
        "purpose": packet["review"]["purpose"], "artifacts": len(packet["review"]["artifacts"]),
        "requirements": len(packet["review"]["requirements"]), "members": len(manifest["members"]),
    }
    # The original importer preflights the complete chain and source bindings.
    # Compatible newer local replies are retained rather than replaced.
    joined = reviews.import_packet(workspace, packet)
    with held(workspace.root / ".workspace.lock", blocking=False):
        retained = workspace._save(KIND, payload)
    return retained, joined


def _view_record(workspace, view_id):
    value = workspace._get(VIEW_KIND, identifier(view_id))
    if value.get("schema") != "upstate." + VIEW_KIND + "/v1" or value.get("project_id") != workspace.project["id"]:
        raise ValueError("Open this review viewer in its original scientific project")
    row = record(workspace, value["receipt_id"])
    if value["review_id"] != row["review_id"] or value["package_sha256"] != row["package_sha256"]:
        raise ValueError("The local viewer belongs to a different received package")
    identifier(value["template_sha256"])
    _descriptor(value["native_index"])
    if value["native_index"].get("path") != "native-index.html":
        raise ValueError("The maintained review viewer has a different original path")
    return value, row


def _directory(path, *, create=False):
    path = Path(path).absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if create:
            current.mkdir(exist_ok=True)
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError("The local review viewer crosses a changed directory")
    return path


def view(workspace, view_id, root, *, verify_all=False):
    """Resolve an immutable viewer without trusting received active HTML."""
    value, row = _view_record(workspace, view_id)
    return _inspect_view(value, row, root, verify_all=verify_all)


def _inspect_view(value, row, root, *, verify_all=False):
    scope = _directory(Path(root) / value["id"])
    original = _directory(scope / "original")
    manifest_path = reviews._regular(original, MANIFEST)
    expected = row["original_manifest"]
    if manifest_path.stat().st_size != expected["bytes"] or file_digest(manifest_path) != expected["sha256"]:
        raise ValueError("The received desk's original inventory changed")
    manifest = reviews._check_package_manifest(reviews._read_json_file(manifest_path))
    if (manifest["package_sha256"] != row["package_sha256"]
            or manifest["project_id"] != row["project_id"] or manifest["review_id"] != row["review_id"]
            or manifest["response_ids"] != row["response_ids"]):
        raise ValueError("The received desk differs from its original review edition")
    index = reviews._regular(scope, value["native_index"]["path"])
    if index.stat().st_size != value["native_index"]["bytes"] or file_digest(index) != value["native_index"]["sha256"]:
        raise ValueError("The maintained local review viewer changed")
    if verify_all:
        checked = reviews.inspect_packet(original)
        if checked["manifest"] != manifest:
            raise ValueError("The complete received desk inventory changed")
    return {"view": value, "receipt": row, "directory": original,
            "scope": scope, "manifest": manifest, "native_index": index}


def open_view(workspace, receipt_id, root):
    """Materialize the exact incoming desk with a separately trusted native app."""
    row, inspected = inspect_received(workspace, receipt_id)
    template_before = TEMPLATE.read_bytes()
    # Derived previews are outside the immutable review identity. Recreate them
    # from the actual bound originals, preserving the incoming response prefix.
    native_packet = reviews.show_review(workspace, row["review_id"], previews=True)
    native_packet["responses"] = inspected["packet"]["responses"]
    native_packet["latest_response_id"] = row["incoming_response_id"]
    html = reviews._html(native_packet).encode("utf-8")
    if TEMPLATE.read_bytes() != template_before:
        raise ValueError("The maintained review application changed while opening this package")
    value = {
        "schema": "upstate." + VIEW_KIND + "/v1",
        "project_id": workspace.project["id"], "receipt_id": row["id"], "review_id": row["review_id"],
        "package_sha256": row["package_sha256"],
        "template_sha256": hashlib.sha256(template_before).hexdigest(),
        "native_index": {"path": "native-index.html", "bytes": len(html),
                         "sha256": hashlib.sha256(html).hexdigest()},
    }
    view_id = digest(value)
    root = Path(root).absolute()
    if (root.resolve().is_relative_to(workspace.root.resolve())
            or root.resolve().is_relative_to(Path(__file__).resolve().parents[1])):
        raise ValueError("Build local review views outside the original workspace and application")
    _directory(root, create=True)
    marker = {"schema": "upstate.review-view-intake/v1", "view_id": view_id, "receipt_id": row["id"]}
    prefix = ".review-view-" + view_id + "-"
    with held(root / (".open-" + view_id + ".lock"), blocking=False):
        # Only this exact immutable view's abandoned staging is recovered.
        # The held view lock excludes its active materializer.
        for abandoned in root.glob(prefix + "*"):
            if abandoned.is_symlink() or not abandoned.is_dir():
                raise ValueError("An unfinished original review viewer has an unsafe directory")
            try:
                owner = reviews._regular(abandoned, "operation.json")
            except FileNotFoundError:
                # An interruption before the immutable owner marker is written
                # cannot leave a published view.  Remove only an empty shell;
                # preserve any unbound bytes and continue in a fresh directory.
                if not any(abandoned.iterdir()):
                    abandoned.rmdir()
                continue
            if reviews._read_json_file(owner) != marker:
                raise ValueError("An unfinished review viewer belongs to another original selection")
            shutil.rmtree(abandoned)
        destination = root / view_id
        if destination.exists() or destination.is_symlink():
            # A crash may publish the complete view before its canonical record.
            # Verify every original member before retaining its deterministic
            # viewer record. A present damaged cache remains an explicit error.
            _inspect_view({**value, "id": view_id}, row, root, verify_all=True)
            with held(workspace.root / ".workspace.lock", blocking=False):
                retained = workspace._save(VIEW_KIND, value)
            return view(workspace, retained["id"], root)
        pending = Path(tempfile.mkdtemp(prefix=prefix, dir=root))
        try:
            atomic_json(pending / "operation.json", marker, immutable=True)
            archive, _ = archive_file(workspace, receipt_id)
            reviews.receive_packet(archive, pending / "original")
            native = pending / "native-index.html"
            with native.open("xb") as file:
                file.write(html)
                file.flush()
                os.fsync(file.fileno())
            if file_digest(native) != value["native_index"]["sha256"]:
                raise ValueError("The local review application changed during publication")
            if destination.exists() or destination.is_symlink():
                raise ValueError("The selected original review view appeared during receiving")
            os.rename(pending, destination)
            pending = None
            with held(workspace.root / ".workspace.lock", blocking=False):
                retained = workspace._save(VIEW_KIND, value)
            return view(workspace, retained["id"], root, verify_all=True)
        finally:
            if pending is not None:
                shutil.rmtree(pending)


def show(workspace, receipt_id):
    row, inspected = inspect_received(workspace, receipt_id)
    current = reviews.history(workspace, row["review_id"])
    return {
        "receipt": {**row, **summary(row)},
        "review": inspected["packet"]["review"], "responses": inspected["packet"]["responses"],
        "incoming_response_id": row["incoming_response_id"],
        "current_latest_response_id": current[-1]["id"] if current else None,
        "packet": inspected["packet"],
    }
