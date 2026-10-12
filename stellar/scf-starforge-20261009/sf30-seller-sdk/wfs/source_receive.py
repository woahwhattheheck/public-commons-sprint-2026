"""MIT. Receive complete WFS project bytes through the original SF88/SF100 delivery."""
from __future__ import annotations
from dataclasses import dataclass
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent.parent / "sf88-operator-buyer-cli" / "python"))
from source_file_delivery import (COMMON_FIELDS, SourceFileContract, SourceFileDeliveryError,
                                 SourceFiles, restore_file_projection, read_member)
from stellar_forge_buyer.datasets import DatasetDelivery
from stellar_forge_buyer.storage import parse, private_directory

SOURCE_BYTES = 128 * 1024 * 1024
COLUMNS = ["capture_id", "source_set_id", "path", "file_sha256", "file_bytes",
           "chunk_index", "chunk_count", "chunk_sha256", "content_base64"]
COLLECTIONS = ("sources", "schemas", "queries", "orders", "publications", "comparisons", "operations")


def checksum(value):
    # This bundle's canonical body contains fixed object keys, strings, lists
    # and safe nonnegative integer byte/revision fields; source bytes are base64.
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False,
                     sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def text(value, name, contract, maximum=512):
    if not isinstance(value, str) or not 0 < len(value) <= maximum or "\x00" in value:
        contract.fail("SOURCE_TEXT_INVALID", field=name)
    return value


def safe_integer(value, name, contract):
    value = contract.integer(value, name)
    if value > 9007199254740991:
        contract.fail("SOURCE_INTEGER_INVALID", field=name)
    return value


def row_identity(row, contract):
    return contract.sha(row.get("source_set_id"), "source_set_id")


def validate_manifest(value, source_set_id, expected, contract):
    if (value.get("sourceSetId") != source_set_id or set(expected) != {"project-bundle.json"}
            or expected["project-bundle.json"]["bytes"] > SOURCE_BYTES):
        contract.fail("SOURCE_MANIFEST_CHANGED")
    contract.sha(value.get("sourceSetId"), "sourceSetId")
    contract.sha(value.get("snapshot"), "snapshot")
    text(value.get("publicationId"), "publicationId", contract, 128)
    text(value.get("originalProjectId"), "originalProjectId", contract, 128)


@dataclass(frozen=True)
class WfsSourceFiles(SourceFiles):
    contract = SourceFileContract(
        manifest_path="sources-manifest.json",
        manifest_schema="stellar-forge.wfs-source-files.v1",
        prefix="WFS", error_type=SourceFileDeliveryError,
        required_fields=COMMON_FIELDS | {"source_set_id"},
        row_identity=row_identity, validate_manifest=validate_manifest,
        staging_prefix=".wfs-source-receive-",
    )

    def inspect_sources(self):
        """Validate every original bundle byte without reserializing source files."""
        contract = self.contract
        bundle = parse(self.read_file("project-bundle.json"))
        if (not isinstance(bundle, dict)
                or set(bundle) != {"schema", "project", "totalBytes", "files", "bundleSha256"}
                or bundle.get("schema") != "stellar-forge.wfs-project-bundle.v1"):
            contract.fail("PROJECT_BUNDLE_INVALID")
        project = bundle.get("project")
        if (not isinstance(project, dict)
                or set(project) != {"id", "name", "revision", "indexSha256", "indexBytes"}):
            contract.fail("PROJECT_HEADER_INVALID")
        text(project.get("id"), "project.id", contract, 128)
        text(project.get("name"), "project.name", contract, 1000)
        safe_integer(project.get("revision"), "project.revision", contract)
        safe_integer(project.get("indexBytes"), "project.indexBytes", contract)
        contract.sha(project.get("indexSha256"), "project.indexSha256")
        source_set_id = contract.sha(bundle.get("bundleSha256"), "bundleSha256")
        if source_set_id != self.manifest["sourceSetId"] or project["id"] != self.manifest["originalProjectId"]:
            contract.fail("PROJECT_SOURCE_SELECTION_CHANGED")
        total_expected = safe_integer(bundle.get("totalBytes"), "totalBytes", contract)
        if total_expected > SOURCE_BYTES:
            contract.fail("PROJECT_BUNDLE_TOO_LARGE")
        members = bundle.get("files")
        if not isinstance(members, list) or not 1 <= len(members) <= 100000:
            contract.fail("PROJECT_FILE_INVENTORY_INVALID")
        names, total, project_raw = set(), 0, None
        for member in members:
            if not isinstance(member, dict) or set(member) != {"path", "bytes", "sha256", "base64"}:
                contract.fail("PROJECT_FILE_INVALID")
            name = contract.name(member["path"])
            if name in names:
                contract.fail("PROJECT_DUPLICATE_MEMBER", path=name)
            names.add(name)
            length = safe_integer(member["bytes"], "bytes", contract)
            expected_sha = contract.sha(member["sha256"], "sha256")
            encoded = member["base64"]
            if (not isinstance(encoded, str) or length > SOURCE_BYTES
                    or len(encoded) != 4 * ((length + 2) // 3)):
                contract.fail("PROJECT_FILE_ENCODING_INVALID", path=name)
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, UnicodeError, binascii.Error):
                contract.fail("PROJECT_FILE_ENCODING_INVALID", path=name)
            if (len(raw) != length or base64.b64encode(raw).decode("ascii") != encoded
                    or hashlib.sha256(raw).hexdigest() != expected_sha):
                contract.fail("PROJECT_FILE_CHANGED", path=name)
            total += length
            if total > SOURCE_BYTES:
                contract.fail("PROJECT_BUNDLE_TOO_LARGE")
            if name == "project.json":
                if length != project["indexBytes"] or expected_sha != project["indexSha256"]:
                    contract.fail("PROJECT_INDEX_CHANGED")
                project_raw = raw
        if total != total_expected or project_raw is None:
            contract.fail("PROJECT_FILE_INVENTORY_CHANGED")
        body = {key: value for key, value in bundle.items() if key != "bundleSha256"}
        if checksum(body) != source_set_id:
            contract.fail("PROJECT_BUNDLE_IDENTITY_CHANGED")
        index = parse(project_raw)
        if (not isinstance(index, dict) or index.get("schema") != "stellar-forge.wfs-project.v1"
                or any(index.get(key) != project[key] for key in ("id", "name", "revision"))
                or any(not isinstance(index.get(key), list) for key in COLLECTIONS)):
            contract.fail("PROJECT_INDEX_BINDING_CHANGED")
        publications = [item for item in index["publications"]
                        if isinstance(item, dict) and item.get("id") == self.manifest["publicationId"]]
        if len(publications) != 1 or publications[0].get("snapshot") != self.manifest["snapshot"]:
            contract.fail("ORIGINAL_PUBLICATION_CHANGED")
        return {
            "sourceSetId": source_set_id, "publicationId": self.manifest["publicationId"],
            "snapshot": self.manifest["snapshot"], "project": project,
            "projectFiles": len(members), "projectBytes": total,
            "counts": {key: len(index[key]) for key in COLLECTIONS},
        }

    def settle(self):
        """Settle the original file/directory publication before its final receipt."""
        for member in self.manifest["files"] + [{"path": self.contract.manifest_path}]:
            descriptor = os.open(self.directory / member["path"], os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        current = self.directory
        while True:
            descriptor = os.open(current, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            if current == current.parent:
                break
            current = current.parent


def receive_wfs_sources(delivery, destination, *, expected_capture_id=None, expected_source_set_id=None):
    def selected(identity):
        if expected_source_set_id is not None and identity != expected_source_set_id:
            raise SourceFileDeliveryError("WFS_SOURCE_SET_CHANGED")
    # The original delivery verifies each selected file on the same descriptor.
    with delivery.file("manifest.json").open() as stream:
        raw = stream.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise SourceFileDeliveryError("WFS_NATIVE_MANIFEST_TOO_LARGE")
    native_manifest = parse(raw)
    dataset = native_manifest.get("dataset") if isinstance(native_manifest, dict) else None
    native = delivery.native
    if (not isinstance(native_manifest, dict)
            or native_manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1"
            or not isinstance(dataset, dict) or dataset.get("projectedFields") != COLUMNS
            or dataset.get("snapshot") != native["nativeStatus"].get("snapshot")
            or dataset.get("rows") != native["nativeStatus"].get("rows")
            or native["nativeStatus"].get("finalized") is not True
            or not isinstance(native_manifest.get("outputs"), dict)
            or any(native_manifest["outputs"].get(name, {}).get(key) != native["outputs"].get(name, {}).get(key)
                   for name in ("dataset.jsonl", "dataset.csv", "review.html")
                   for key in ("bytes", "sha256"))):
        raise SourceFileDeliveryError("WFS_COMPLETE_ORIGINAL_SOURCE_PROJECTION_REQUIRED")
    files = restore_file_projection(delivery, destination, result_type=WfsSourceFiles,
                                    expected_capture_id=expected_capture_id, check_identity=selected)
    if files.acquired_rows != dataset["rows"]:
        raise SourceFileDeliveryError("WFS_ORIGINAL_ROW_COUNT_CHANGED")
    summary = files.inspect_sources()
    files.settle()
    return files, summary


def inspect_wfs_sources(directory, *, expected_capture_id, expected_source_set_id):
    """Reopen the exact original receiving inventory and every complete member."""
    contract = WfsSourceFiles.contract
    contract.sha(expected_capture_id, "expected_capture_id")
    contract.sha(expected_source_set_id, "expected_source_set_id")
    root = private_directory(Path(directory), create=False)
    path = root / contract.manifest_path
    size = path.stat(follow_symlinks=False).st_size
    if size > 1048576:
        contract.fail("SOURCE_MANIFEST_TOO_LARGE")
    raw = read_member(root, {"path": contract.manifest_path, "bytes": size,
                            "sha256": expected_capture_id}, contract, collect=True)
    manifest = parse(raw)
    if not isinstance(manifest, dict) or manifest.get("schema") != contract.manifest_schema:
        contract.fail("SOURCE_MANIFEST_CHANGED")
    expected = {}
    for item in manifest.get("files", []):
        if not isinstance(item, dict):
            contract.fail("SOURCE_MANIFEST_CHANGED")
        name = contract.name(item.get("path"))
        if name in expected:
            contract.fail("SOURCE_DUPLICATE_MEMBER")
        expected[name] = {"path": name, "bytes": contract.integer(item.get("bytes"), "bytes"),
                          "sha256": contract.sha(item.get("sha256"), "sha256")}
    validate_manifest(manifest, expected_source_set_id, expected, contract)
    files = WfsSourceFiles(directory=root, capture_id=expected_capture_id, manifest=manifest,
                          native_status="RETAINED_ORIGINAL_FILES", payment_status="RETAINED_ORIGINAL_DELIVERY",
                          acquired_rows=0, reopened=True)
    summary = files.inspect_sources()
    files.settle()
    return files, summary


def main():
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Original delivery descriptor exceeds4 MiB")
    value = parse(raw)
    if not isinstance(value, dict):
        raise ValueError("Select the original receiving descriptor")
    if value.get("mode") == "inspect":
        if set(value) != {"mode", "directory", "expectedCaptureId", "expectedSourceSetId"}:
            raise ValueError("Select the exact retained source binding")
        files, summary = inspect_wfs_sources(value["directory"],
                                            expected_capture_id=value["expectedCaptureId"],
                                            expected_source_set_id=value["expectedSourceSetId"])
        print(json.dumps({"schema": "stellar-forge.wfs-source-inspection.v1",
                          "directory": str(files.directory), "captureManifestSha256": files.capture_id,
                          "manifest": files.manifest, **summary}, ensure_ascii=False))
        return
    common = {"directory", "expectedCaptureId", "expectedSourceSetId"}
    if set(value) == common | {"report"}:
        report = value["report"]
        if (not isinstance(report, dict) or report.get("schema") != "stellar-forge.sf88.dataset-delivery.v1"
                or report.get("nativeStatus", {}).get("finalized") is not True
                or not isinstance(report.get("outputs"), dict)):
            raise ValueError("Use the original finalized SF88 DatasetDelivery report")
        root = private_directory(Path(report["directory"]), create=False)
        delivery = DatasetDelivery(report, root)
    elif set(value) == common | {"nativeScan"}:
        # This is the original full SF100 source/session/page-chain receiver.
        delivery = DatasetDelivery.from_finalized_scan(value["nativeScan"])
    else:
        raise ValueError("Select one original finalized report or native SF100 scan")
    files, summary = receive_wfs_sources(delivery, value["directory"],
                                        expected_capture_id=value["expectedCaptureId"],
                                        expected_source_set_id=value["expectedSourceSetId"])
    print(json.dumps({"schema": "stellar-forge.wfs-source-receipt.v1",
                      "directory": str(files.directory), "captureManifestSha256": files.capture_id,
                      "manifest": files.manifest, "reopened": files.reopened,
                      "acquiredRows": files.acquired_rows, "nativeStatus": files.native_status,
                      "paymentStatus": files.payment_status, **summary}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({"code": getattr(error, "code", "WFS_RECEIVING_FAILED"),
                          "message": str(error)}), file=sys.stderr)
        raise SystemExit(2)
