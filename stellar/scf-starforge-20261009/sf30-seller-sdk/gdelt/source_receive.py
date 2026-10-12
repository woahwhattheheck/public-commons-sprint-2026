"""MIT. Reopen complete GDELT source files through the original dataset receiver."""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import base64
import re
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
from zip_decode import decode as decode_zip

ATTRIBUTION = "Source: The GDELT Project — https://www.gdeltproject.org/"
CODEBOOK = "https://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf"


def checksum(value):
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def source_descriptors(record, batch, contract):
    body = record.get("body")
    if (record.get("url") not in {
            "https://data.gdeltproject.org/gdeltv2/lastupdate.txt",
            "https://data.gdeltproject.org/gdeltv2/masterfilelist.txt"}
            or record.get("status") not in {200, 206} or not isinstance(body, str)
            or len(body.encode()) > 1048576 or len(body.encode()) != record.get("bytes")
            or hashlib.sha256(body.encode()).hexdigest() != record.get("sha256")):
        contract.fail("ORIGINAL_MANIFEST_CHANGED")
    if record["status"] == 206:
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", record.get("headers", {}).get("content-range", ""))
        if not match:
            contract.fail("ORIGINAL_MANIFEST_RANGE_CHANGED")
        start, end, total = map(int, match.groups())
        if not 0 <= start <= end < total or end - start + 1 != record["bytes"]:
            contract.fail("ORIGINAL_MANIFEST_RANGE_CHANGED")
        if start > 0:
            body = body[body.find("\n") + 1:]
        if not body.endswith("\n"):
            body = body[:body.rfind("\n") + 1]
    selected, addresses = {}, set()
    for line in body.splitlines():
        if not line:
            continue
        match = re.fullmatch(r"(\d+) ([a-fA-F0-9]{32}) (https?://data\.gdeltproject\.org/gdeltv2/(\d{14})\.(export\.CSV|mentions\.CSV|gkg\.csv)\.zip)", line)
        if not match or match[3] in addresses:
            contract.fail("ORIGINAL_MANIFEST_LINES_CHANGED")
        addresses.add(match[3])
        kind = {"export.CSV": "events", "mentions.CSV": "mentions", "gkg.csv": "gkg"}[match[5]]
        if match[4] == batch and kind != "gkg":
            if kind in selected or int(match[1]) > 24 * 1024 * 1024:
                contract.fail("ORIGINAL_MANIFEST_SELECTION_CHANGED")
            selected[kind] = {"batch": batch, "kind": kind, "bytes": int(match[1]),
                              "md5": match[2].lower(), "advertisedUrl": match[3],
                              "url": re.sub(r"^http:", "https:", match[3]),
                              "member": batch + "." + match[5]}
    if set(selected) != {"events", "mentions"}:
        contract.fail("ORIGINAL_MANIFEST_SELECTION_CHANGED")
    return selected


def row_identity(row, contract):
    return contract.sha(row.get("source_set_id"), "source_set_id")


def validate_manifest(value, source_set_id, expected, contract):
    if (value.get("sourceSetId") != source_set_id or value.get("attribution") != ATTRIBUTION
            or value.get("codebookUrl") != CODEBOOK
            or set(expected) != {"source-set.json", "gdelt-schema.json", "review.json"}):
        contract.fail("SOURCE_MANIFEST_CHANGED")
    contract.sha(value.get("reviewId"), "reviewId")


@dataclass(frozen=True)
class GdeltSourceFiles(SourceFiles):
    contract = SourceFileContract(
        manifest_path="sources-manifest.json",
        manifest_schema="stellar-forge.gdelt-source-files.v1",
        prefix="GDELT", error_type=SourceFileDeliveryError,
        required_fields=COMMON_FIELDS | {"source_set_id"},
        row_identity=row_identity, validate_manifest=validate_manifest,
        staging_prefix=".gdelt-source-receive-",
    )

    def inspect_sources(self):
        source_set = parse(self.read_file("source-set.json"))
        if (source_set.get("schema") != "stellar-forge.gdelt-source-set.v1"
                or source_set.get("attribution") != ATTRIBUTION
                or source_set.get("codebookUrl") != CODEBOOK
                or not isinstance(source_set.get("captures"), list)):
            self.contract.fail("SOURCE_SET_INVALID")
        identity = {key: source_set[key] for key in ("schema", "captures", "attribution", "codebookUrl")}
        if (checksum(identity) != source_set.get("sourceSetId")
                or source_set["sourceSetId"] != self.manifest["sourceSetId"]):
            self.contract.fail("SOURCE_SET_CHANGED")
        batches, captures = [], []
        for capture in source_set["captures"]:
            identity = {key: capture[key] for key in ("schema", "batch", "manifest", "sources", "attribution", "codebookUrl")}
            if (capture.get("schema") != "stellar-forge.gdelt-capture.v1"
                    or checksum(identity) != capture.get("captureId")
                    or capture.get("attribution") != ATTRIBUTION
                    or capture.get("codebookUrl") != CODEBOOK
                    or len(capture.get("sources", [])) != 2):
                self.contract.fail("CAPTURE_CHANGED")
            descriptors = source_descriptors(capture["manifest"], capture["batch"], self.contract)
            kinds = set()
            for source in capture["sources"]:
                kind = source.get("kind")
                if kind not in {"events", "mentions"} or kind in kinds:
                    self.contract.fail("SOURCE_TABLE_INVENTORY_CHANGED")
                kinds.add(kind)
                descriptor = descriptors[kind]
                original = base64.b64decode(source["zipBase64"], validate=True)
                if (source.get("request") != descriptor or source.get("url") != descriptor["url"]
                        or source.get("status") != 200 or len(original) != source.get("bytes")
                        or len(original) != descriptor["bytes"]
                        or hashlib.sha256(original).hexdigest() != source.get("sha256")
                        or hashlib.md5(original).hexdigest() != descriptor["md5"]
                        or base64.b64encode(original).decode() != source["zipBase64"]):
                    self.contract.fail("ORIGINAL_SOURCE_ZIP_CHANGED")
                decoded = decode_zip({"member": source["request"]["member"], "zip_base64": source["zipBase64"]})
                if decoded != source["table"]:
                    self.contract.fail("SOURCE_ZIP_BINDING_CHANGED")
            batches.append(capture["batch"])
            captures.append(capture["captureId"])
        if not 1 <= len(batches) <= 32 or len(set(batches)) != len(batches):
            self.contract.fail("SOURCE_BATCH_INVENTORY_CHANGED")
        review = parse(self.read_file("review.json"))
        semantics = parse(self.read_file("gdelt-schema.json"))
        identity = {key: review[key] for key in ("captureIds", "policy", "note", "name")}
        if (review.get("schema") != "stellar-forge.gdelt-review.v1"
                or checksum(identity) != review.get("id")
                or review["id"] != self.manifest["reviewId"]
                or review["captureIds"] != captures
                or review.get("semantics") != semantics
                or semantics.get("schema") != "stellar-forge.gdelt-schema.v1"
                or semantics.get("captureIds") != captures):
            self.contract.fail("REVIEW_OR_MEANING_CHANGED")
        return {"sourceSetId": source_set["sourceSetId"], "captureIds": captures, "batches": batches,
                "reviewId": review["id"], "rowCount": review["rowCount"],
                "table": review["policy"]["table"], "attribution": ATTRIBUTION}

    def settle(self):
        """Settle recovered file/directory publication before returning the receipt."""
        for member in self.manifest["files"] + [{"path": "sources-manifest.json"}]:
            path = self.directory / member["path"]
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
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


def receive_gdelt_sources(delivery, destination, *, expected_capture_id=None, expected_source_set_id=None):
    def selected(identity):
        if expected_source_set_id is not None and identity != expected_source_set_id:
            raise SourceFileDeliveryError("GDELT_SOURCE_SET_CHANGED")
    files = restore_file_projection(delivery, destination, result_type=GdeltSourceFiles,
                                    expected_capture_id=expected_capture_id, check_identity=selected)
    summary = files.inspect_sources()
    files.settle()
    return files, summary


def inspect_gdelt_sources(directory, *, expected_capture_id, expected_source_set_id):
    """Open the original received inventory and verify every delivered member."""
    contract = GdeltSourceFiles.contract
    contract.sha(expected_capture_id, "expected_capture_id")
    contract.sha(expected_source_set_id, "expected_source_set_id")
    root = private_directory(Path(directory), create=False)
    path = root / contract.manifest_path
    stat = path.stat(follow_symlinks=False)
    if stat.st_size > 1048576:
        contract.fail("SOURCE_MANIFEST_TOO_LARGE")
    raw = read_member(root, {"path": contract.manifest_path, "bytes": stat.st_size,
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
    files = GdeltSourceFiles(directory=root, capture_id=expected_capture_id, manifest=manifest,
                            native_status="RETAINED_ORIGINAL_FILES", payment_status="RETAINED_ORIGINAL_DELIVERY",
                            acquired_rows=0, reopened=True)
    summary = files.inspect_sources()
    files.settle()
    return files, summary


def main():
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Original delivery descriptor exceeds 4 MiB")
    value = parse(raw)
    if value.get("mode") == "inspect":
        if set(value) != {"mode", "directory", "expectedCaptureId", "expectedSourceSetId"}:
            raise ValueError("Select the exact retained receiving binding")
        files, summary = inspect_gdelt_sources(value["directory"],
                                              expected_capture_id=value["expectedCaptureId"],
                                              expected_source_set_id=value["expectedSourceSetId"])
        print(json.dumps({"schema": "stellar-forge.gdelt-source-inspection.v1",
                          "directory": str(files.directory), "captureManifestSha256": files.capture_id,
                          "manifest": files.manifest, **summary}, ensure_ascii=False))
        return
    if set(value) != {"report", "directory", "expectedCaptureId", "expectedSourceSetId"}:
        raise ValueError("Select the original dataset delivery and private receiving directory")
    report = value["report"]
    if (report.get("schema") != "stellar-forge.sf88.dataset-delivery.v1"
            or report.get("nativeStatus", {}).get("finalized") is not True
            or not isinstance(report.get("outputs"), dict)):
        raise ValueError("Use the original finalized SF88 DatasetDelivery report")
    root = private_directory(Path(report["directory"]), create=False)
    delivery = DatasetDelivery(report, root)
    files, summary = receive_gdelt_sources(delivery, value["directory"],
                                         expected_capture_id=value["expectedCaptureId"],
                                         expected_source_set_id=value["expectedSourceSetId"])
    print(json.dumps({"schema": "stellar-forge.gdelt-source-receipt.v1",
                      "directory": str(files.directory), "captureManifestSha256": files.capture_id,
                      "manifest": files.manifest, "reopened": files.reopened,
                      "acquiredRows": files.acquired_rows, "nativeStatus": files.native_status,
                      "paymentStatus": files.payment_status, **summary}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({"code": getattr(error, "code", "GDELT_RECEIVING_FAILED"), "message": str(error)}), file=sys.stderr)
        raise SystemExit(2)
