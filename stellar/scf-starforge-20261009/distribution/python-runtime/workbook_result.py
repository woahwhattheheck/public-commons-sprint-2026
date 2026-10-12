"""Read original WorkbookDelivery outputs for the managed Applications view."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
from pathlib import Path
import stat
import sys
import zipfile

from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
from stellar_forge_buyer.storage import parse as original_parse

MAX_JSON = 4 * 1024 * 1024
SCHEMA = "stellar-forge.workbook-application-result.v1"


def require(value, message):
    if not value:
        raise ValueError(message)


def object_file(path, maximum=MAX_JSON):
    path = Path(path)
    require(path.resolve() == path, "Select the original real file.")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        first = os.fstat(stream.fileno())
        require(stat.S_ISREG(first.st_mode) and first.st_size <= maximum, "The original JSON file is too large or unavailable.")
        raw = stream.read(maximum + 1)
        last = os.fstat(stream.fileno())
    require(len(raw) <= maximum and (first.st_dev, first.st_ino, first.st_size, first.st_mtime_ns, first.st_ctime_ns) ==
            (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns, last.st_ctime_ns), "The original JSON file changed.")
    value = original_parse(raw)
    require(isinstance(value, dict), "The original record must be a JSON object.")
    return value, raw


def file_identity(path):
    path = Path(path)
    require(path.resolve() == path, "The original output location changed.")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        first = os.fstat(stream.fileno())
        require(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and not first.st_mode & 0o077 and
                (not hasattr(os, "getuid") or first.st_uid == os.getuid()), "Select the original private output file.")
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        last = os.fstat(stream.fileno())
    require((first.st_dev, first.st_ino, first.st_size, first.st_mtime_ns, first.st_ctime_ns) ==
            (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns, last.st_ctime_ns), "The original output changed during verification.")
    return {"bytes": first.st_size, "sha256": checksum}


def canonical_path(value):
    require(isinstance(value, str) and value and "\0" not in value, "Select the original absolute path.")
    path = Path(value)
    require(path.is_absolute() and str(path) == value, "Select the original absolute path.")
    return path


def archive_selection(plan):
    path = canonical_path(plan["archive"])
    identity = file_identity(path)
    if plan.get("archive_sha256"):
        require(identity["sha256"] == plan["archive_sha256"], "The selected workbook archive checksum changed.")
    with zipfile.ZipFile(path) as archive:
        names = [row.filename for row in archive.infolist()]
        require(names.count("manifest.json") == 1 and len(names) == len(set(names)), "The workbook archive has repeated or missing manifest members.")
        info = archive.getinfo("manifest.json")
        require(info.file_size <= MAX_JSON and not stat.S_ISLNK(info.external_attr >> 16), "The workbook manifest is unavailable.")
        raw = archive.read(info)
    require(file_identity(path) == identity, "The workbook archive changed during selection.")
    manifest = json.loads(raw)
    require(isinstance(manifest, dict) and manifest.get("complete") is True and
            manifest.get("schema") == "stellar-forge.customer-workbook.v1" and isinstance(manifest.get("files"), dict),
            "Select a complete original workbook archive.")
    return {"schema": SCHEMA, "state": "ARCHIVE_SELECTED", "archive": str(path),
            **identity, "manifest_sha256": hashlib.sha256(raw).hexdigest(), "manifest": manifest}


def pending(state, **values):
    return {"schema": SCHEMA, "state": state, "files": [], **values}


def receipt_selection(plan):
    """Resolve a delivery only through its original request and fixed operation paths."""
    action = plan["action"]
    if action not in {"build", "refresh"}:
        return None, None, None
    operation = canonical_path(plan["operation"])
    if not operation.exists():
        return pending("NOT_CREATED", message="The original delivery operation has not created its request."), None, None
    require(operation.resolve() == operation, "The original delivery operation directory changed.")
    intent_path = operation / "intent.json"
    review_path = operation / "review.json"
    review = object_file(review_path)[0] if review_path.exists() else None
    if not intent_path.exists():
        return pending("REVIEW_REQUIRED" if action == "refresh" and review else "NOT_CREATED",
                       review=review, review_scope="retained-operation" if review else None,
                       message="This delivery operation retains an earlier refresh review. It has no saved client intent linking that review to the selected recipe. Run the original refresh with the current reviewed recipe to obtain its current result." if review else
                       "The original command has not retained a delivery request."), None, None
    intent = object_file(intent_path)[0]
    recipe, recipe_raw = object_file(canonical_path(plan["recipeFile"]), 1024 * 1024)
    if plan.get("recipe_sha256"):
        require(hashlib.sha256(recipe_raw).hexdigest() == plan["recipe_sha256"], "The retained reviewed recipe changed.")
    recipe_identity = hashlib.sha256(json.dumps(recipe, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()).hexdigest()
    require(intent.get("recipe_sha256") == recipe_identity, "The actual delivery intent differs from its selected original recipe.")
    expected = "stellar-forge.workbook-refresh-client-operation.v1" if action == "refresh" else "stellar-forge.workbook-client-operation.v1"
    require(intent.get("schema") == expected and intent.get("database") == plan["database"], "The retained delivery request belongs to another workbook operation.")
    build_id = intent.get("build_id")
    require(isinstance(build_id, str) and len(build_id) == 32 and all(c in "0123456789abcdef" for c in build_id), "The original workbook build identity is invalid.")
    request_file = operation / "build-request.json"
    spec = object_file(request_file)[0] if request_file.exists() else None
    if spec:
        require(spec.get("id") == build_id, "The retained build request belongs to another job.")
    receipt_file = operation / "delivery.json"
    receipt = object_file(receipt_file)[0] if receipt_file.exists() else None
    directory = operation / "received"
    if not directory.exists():
        return pending("DELIVERY_PENDING", job_id=build_id, workspace_id=intent.get("workspace_id"),
                       review=review, message="The Analysis job or original file receiving is still pending. Start this saved application again to continue the same delivery operation."), None, None
    require(spec is not None, "The complete received workbook has no original build request.")
    return {"intent": intent, "spec": spec, "receipt": receipt, "review": review}, directory, operation / "handoff.zip"


def inspect(plan):
    action = plan["action"]
    require(action in {"build", "refresh", "receive", "inspect", "copy"}, "Choose an original workbook action.")
    original, directory, archive = receipt_selection(plan)
    if original is not None and original.get("schema") == SCHEMA:
        return original
    if directory is None:
        directory = canonical_path(plan["directory"])
        archive = canonical_path(plan["archive"]) if plan.get("archive") else None
    if not directory.exists():
        return pending("NOT_CREATED", message="The original command has not published a complete delivery directory.")
    expected = plan.get("manifest_sha256")
    receipt = original["receipt"] if original else None
    if receipt:
        require(receipt.get("status") == "COMPLETE", "The original delivery receipt is incomplete.")
        if expected:
            require(receipt.get("manifest_sha256") == expected, "The original result differs from the reviewed workbook.")
        expected = receipt.get("manifest_sha256")
    delivery = WorkbookDelivery(directory, expected_manifest_sha256=expected)
    manifest = delivery.inspect()
    with delivery.open("definition.json") as stream:
        definition = json.loads(stream.read(MAX_JSON + 1))
    if original:
        intent, spec = original["intent"], original["spec"]
        require(manifest["id"] == intent["build_id"] and manifest.get("workspace_id") == intent.get("workspace_id") and
                manifest.get("name") == spec.get("name") and manifest.get("revision") == spec.get("revision") and
                manifest.get("definition_sha256") == spec.get("definition_sha256"),
                "The received workbook differs from its original selected build.")
        if receipt:
            require(all(receipt.get(key) == manifest.get(key) for key in ("id", "name", "revision", "row_count", "manifest_sha256")),
                    "The saved receipt differs from the complete workbook.")
    files = [{"name": "manifest.json", "path": str(directory / "manifest.json"),
              "bytes": len(delivery.raw), "sha256": manifest["manifest_sha256"], "mime": "application/json"}]
    for name, row in manifest["files"].items():
        files.append({"name": name, "path": str(directory / name), "bytes": row["bytes"], "sha256": row["sha256"],
                      "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if name.endswith(".xlsx") else
                      mimetypes.guess_type(name)[0] or "application/octet-stream"})
    if archive is not None:
        require(archive.exists(), "Keep the original workbook archive for this receiving result.")
        delivery.verify_archive(archive)
        identity = file_identity(archive)
        if plan.get("archive_sha256"):
            require(identity["sha256"] == plan["archive_sha256"], "The original archive bytes changed.")
        if receipt:
            originals = [row for row in receipt.get("files", []) if row.get("name") == "handoff.zip"]
            require(len(originals) == 1 and all(originals[0].get(key) == identity[key] for key in ("bytes", "sha256")),
                    "The retained handover differs from the original saved receipt.")
        files.append({"name": "handoff.zip", "path": str(archive), **identity, "mime": "application/zip"})
    if action == "copy" and not expected:
        source = WorkbookDelivery(canonical_path(plan["source_directory"])).inspect()
        require(source["manifest_sha256"] == manifest["manifest_sha256"], "The copied workbook differs from the selected original.")
    return {"schema": SCHEMA, "state": "VERIFIED", "action": action, "directory": str(directory),
            "manifest_sha256": manifest["manifest_sha256"], "manifest": manifest, "definition": definition,
            "receipt": receipt, "review": original["review"] if original else None,
            "original_build_id": original["intent"]["build_id"] if original else None,
            "selection_pinned": bool(expected or plan.get("archive_sha256") or original), "files": files}


def main():
    raw = sys.stdin.buffer.read(65537)
    require(len(raw) <= 65536, "The selected workbook operation is too large.")
    plan = json.loads(raw)
    require(isinstance(plan, dict), "Select one original workbook operation.")
    value = archive_selection(plan) if plan.get("action") == "archive-selection" else inspect(plan)
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    require(len(encoded) <= 16 * 1024 * 1024, "The original workbook result exceeds the view limit.")
    sys.stdout.buffer.write(encoded + b"\n")


if __name__ == "__main__":
    main()
