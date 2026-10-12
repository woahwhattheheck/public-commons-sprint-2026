"""Matomo source receiving over ORIGINAL DatasetDelivery and source-file restoration.

Run with the SDK root and original buyer python directory on PYTHONPATH.
No provider, wallet, signer or payment operation is performed by this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

from source_file_delivery import (COMMON_FIELDS, SourceFileContract, SourceFiles,
    SourceFileDeliveryError, restore_file_projection)
from stellar_forge_buyer.datasets import DatasetDelivery
from stellar_forge_buyer.storage import private_directory, read, sync_directory, unique_object

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_ARCHIVE = "stellar-forge.matomo-native-handover.v1"
_RECEIVED = "stellar-forge.matomo-received.v1"
_MAX = 600 * 1024 * 1024


class MatomoDeliveryError(SourceFileDeliveryError):
    pass


def fail(code, **details):
    raise MatomoDeliveryError("MATOMO_" + code, **details)


def loads(raw):
    try:
        return json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw,
            object_pairs_hook=unique_object, parse_float=Decimal,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        fail("SOURCE_JSON_INVALID")


def identifier(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        fail("SOURCE_ID_INVALID")
    return value


def row_identity(row, contract):
    return identifier(row.get("edition_id")), identifier(row.get("report_capture_id"))


def validate_manifest(value, identity, members, contract):
    if (value.get("editionId"), value.get("reportCaptureId")) != identity:
        fail("SOURCE_IDENTITY_CHANGED")
    for field in ("sourceSha256", "captureManifestSha256"):
        contract.sha(value.get(field), field)
    if (type(value.get("rows")) is not int or not 0 <= value["rows"] <= 1_000_000
            or not {"capture.json", "catalog.json", "source-reads.json", "report-rows.jsonl"} <= members.keys()):
        fail("SOURCE_MANIFEST_INVALID")


@dataclass(frozen=True)
class MatomoRow:
    """Exact original JSON line plus a lossless Python view (Decimal for decimals)."""
    record: dict
    original: bytes


@dataclass(frozen=True)
class MatomoSourceFiles(SourceFiles):
    contract = SourceFileContract(
        manifest_path="source-files.json",
        manifest_schema="stellar-forge.matomo-source-files.v1",
        prefix="MATOMO", error_type=MatomoDeliveryError,
        required_fields=COMMON_FIELDS | {"edition_id", "report_capture_id"},
        row_identity=row_identity, validate_manifest=validate_manifest,
        staging_prefix=".matomo-source-receive-",
    )

    @classmethod
    def from_dataset(cls, delivery, destination, *, expected_capture_id=None,
                     edition_id=None, report_capture_id=None):
        if edition_id is not None:
            identifier(edition_id)
        if report_capture_id is not None:
            identifier(report_capture_id)

        def selected(actual):
            if edition_id is not None and actual[0] != edition_id:
                fail("EDITION_CHANGED")
            if report_capture_id is not None and actual[1] != report_capture_id:
                fail("REPORT_CAPTURE_CHANGED")

        result = restore_file_projection(delivery, destination, result_type=cls,
            expected_capture_id=expected_capture_id, check_identity=selected)
        capture_raw = result.read_file("capture.json")
        capture = loads(capture_raw)
        catalog_raw = result.read_file("catalog.json")
        catalog = loads(catalog_raw)
        if (hashlib.sha256(capture_raw).hexdigest() != result.manifest["captureManifestSha256"]
                or capture.get("schema") != "stellar-forge.matomo-capture.v1"
                or capture.get("id") != result.manifest["reportCaptureId"]
                or capture.get("sourceSha256") != result.manifest["sourceSha256"]
                or capture.get("coverage", {}).get("rows") != result.manifest["rows"]
                or catalog.get("id") != capture.get("catalogId")
                or hashlib.sha256(catalog_raw).hexdigest() != capture.get("catalogManifest", {}).get("sha256")):
            fail("SOURCE_CAPTURE_BINDING_CHANGED")
        return result

    @property
    def edition_id(self):
        return self.manifest["editionId"]

    @property
    def report_capture_id(self):
        return self.manifest["reportCaptureId"]

    def capture(self):
        return loads(self.read_file("capture.json"))

    def rows(self, *, table_id=None, report_id=None):
        """Stream native source rows, preserving JSON values and source positions."""
        member = self.member("report-rows.jsonl")
        path = self.source_path("report-rows.jsonl")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        count, size, digest = 0, 0, hashlib.sha256()
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                    or before.st_mode & 0o077 or before.st_size != member["bytes"]):
                fail("SOURCE_FILE_CHANGED")
            while raw := stream.readline(8 * 1024 * 1024 + 1):
                if len(raw) > 8 * 1024 * 1024 or not raw.endswith(b"\n"):
                    fail("SOURCE_ROW_INVALID")
                count += 1
                size += len(raw)
                digest.update(raw)
                row = loads(raw)
                if (not isinstance(row, dict) or not isinstance(row.get("data"), dict)
                        or not isinstance(row.get("metadata"), dict)
                        or not isinstance(row.get("context"), dict)
                        or type(row.get("sourceRow")) is not int
                        or type(row.get("sourceIndex")) is not int
                        or not isinstance(row.get("id"), str)
                        or not _SHA.fullmatch(row["id"])):
                    fail("SOURCE_ROW_INVALID")
                if ((table_id is None or row.get("tableId") == table_id)
                        and (report_id is None or row["context"].get("reportId") == report_id)):
                    yield MatomoRow(row, raw)
            after = os.fstat(stream.fileno())
            if ((before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    != (after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                    or count != self.manifest["rows"] or size != member["bytes"]
                    or digest.hexdigest() != member["sha256"]):
                fail("SOURCE_ROWS_CHANGED")


def native_scan(directory, *, node="node"):
    script = Path(__file__).with_name("operator-scan.mjs")
    result = subprocess.run([node, str(script), str(directory)], capture_output=True,
                            timeout=120, check=False)
    if result.returncode != 0 or len(result.stdout) > 16 * 1024 * 1024:
        fail("ORIGINAL_SF100_SCAN_FAILED")
    return loads(result.stdout)


def _native_name(name):
    if name in {"manifest.json", "dataset.jsonl", "dataset.csv", "review.html",
                "semantics.json", "session.json"} or re.fullmatch(r"pages/[0-9]{5}\.json", name):
        return name
    fail("NATIVE_MEMBER_INVALID")


def _sha_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    size, checksum = 0, hashlib.sha256()
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o077:
            fail("PRIVATE_FILE_REQUIRED")
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            checksum.update(chunk)
            if size > _MAX:
                fail("ARCHIVE_TOO_LARGE")
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("FILE_CHANGED")
    return {"bytes": size, "sha256": checksum.hexdigest()}


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def _output(path):
    path = Path(os.path.abspath(Path(path).expanduser()))
    if private_directory(path.parent) != path.parent:
        fail("OUTPUT_CANONICAL_PATH_REQUIRED")
    return path



def _evidence_name(name):
    if isinstance(name, str) and re.fullmatch(r"operator-pages/[0-9]{5}\.(request|response|receipt)\.json", name):
        return name
    fail("OPERATOR_EVIDENCE_NAME_INVALID")


def operator_evidence(delivery, directory):
    """Bind the exact reviewed request, original body and receipt to each native page."""
    directory = Path(directory)
    if private_directory(directory, create=False) != directory:
        fail("OPERATOR_EVIDENCE_DIRECTORY_INVALID")
    records, members = [], []
    for index, page in enumerate(delivery.native["originalNativeScan"]["pages"]):
        prefix = str(index).zfill(5)
        values, pins = {}, {}
        for kind in ("request", "response", "receipt"):
            filename = prefix + "." + kind + ".json"
            path = directory / filename
            pin = _sha_file(path)
            raw = read(path, 2 * 1024 * 1024)
            if len(raw) != pin["bytes"] or hashlib.sha256(raw).hexdigest() != pin["sha256"]:
                fail("OPERATOR_EVIDENCE_CHANGED")
            values[kind], pins[kind] = loads(raw), pin
            members.append({"path": "operator-pages/" + filename, **pin})
        request, response, receipt = values["request"], values["response"], values["receipt"]
        authorization = request.get("authorization", {})
        if (request.get("schema") != "stellar-forge.matomo-operator-page.v1"
                or request.get("id") != page["intent"]
                or request.get("query", {}).get("cursor") != page.get("requestCursor")
                or request.get("providerRequest") is not False or request.get("paymentRequest") is not False
                or authorization.get("kind") != "REVIEWED_LOCAL_DATASET_OPERATOR"
                or not isinstance(authorization.get("reviewer"), str) or not authorization["reviewer"].strip()
                or not isinstance(authorization.get("note"), str) or not authorization["note"].strip()
                or pins["request"]["sha256"] != page.get("evidenceSha256")
                or pins["response"]["sha256"] != page["sourceSha256"]
                or response.get("schema") != "stellar-forge.dataset-page.v1"
                or receipt.get("schema") != "stellar-forge.matomo-operator-response.v1"
                or receipt.get("requestId") != page["intent"] or receipt.get("status") != 200
                or receipt.get("bodySha256") != pins["response"]["sha256"]
                or receipt.get("bodyBytes") != pins["response"]["bytes"]
                or receipt.get("providerRequest") is not False or receipt.get("paymentRequest") is not False):
            fail("OPERATOR_PAGE_BINDING_CHANGED")
        for field in ("configSha256", "csvSha256"):
            if not _SHA.fullmatch(request.get(field, "")):
                fail("OPERATOR_SOURCE_BINDING_INVALID")
        records.append({"index": index, "intent": page["intent"],
            "request": "operator-pages/" + prefix + ".request.json",
            "response": "operator-pages/" + prefix + ".response.json",
            "receipt": "operator-pages/" + prefix + ".receipt.json"})
    return records, members


def _copy_evidence(path, output, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    checksum, size = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            fail("PRIVATE_FILE_REQUIRED")
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > expected["bytes"]:
                fail("OPERATOR_EVIDENCE_CHANGED")
            checksum.update(chunk)
            output.write(chunk)
    if size != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
        fail("OPERATOR_EVIDENCE_CHANGED")


def pack_scan(scan, destination, *, evidence_directory):
    """Package only the original verified native data room, retaining its source scan."""
    delivery = DatasetDelivery.from_finalized_scan(scan)
    members = []
    for name in delivery.file_names():
        _native_name(name)
        expected = delivery.native["outputs"].get(name) or delivery.native["archives"][name]
        members.append({"path": "data-room/" + name, "bytes": expected["bytes"], "sha256": expected["sha256"]})
    evidence, evidence_members = operator_evidence(delivery, evidence_directory)
    members.extend(evidence_members)
    if sum(item["bytes"] for item in members) > _MAX:
        fail("ARCHIVE_TOO_LARGE")
    manifest = {"schema": _ARCHIVE, "sourceFormat": "SF100_SCAN",
                "originalScan": scan, "operatorEvidence": evidence, "files": members,
                "paymentStatus": delivery.payment_status}
    raw = _json(manifest)
    destination = _output(destination)
    fd, temporary = tempfile.mkstemp(prefix=".matomo-handover-", dir=destination.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            for name, source in [("handover.json", raw)] + [(item["path"], None) for item in members]:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                with archive.open(info, "w", force_zip64=True) as target:
                    if source is not None:
                        target.write(source)
                    elif name.startswith("operator-pages/"):
                        expected = next(item for item in evidence_members if item["path"] == name)
                        _copy_evidence(Path(evidence_directory) / name.removeprefix("operator-pages/"), target, expected)
                    else:
                        with delivery.file(name.removeprefix("data-room/")).open() as stream:
                            shutil.copyfileobj(stream, target, length=1024 * 1024)
        with open(temporary, "rb") as stream:
            os.fsync(stream.fileno())
        pin = _sha_file(temporary)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if _sha_file(destination) != pin:
                fail("HANDOVER_OUTPUT_CONFLICT")
        os.unlink(temporary)
        sync_directory(destination.parent)
        return {"path": str(destination), **pin, "nativeRows": scan["count"],
                "nativePages": len(scan["pages"]), "paymentStatus": delivery.payment_status}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@dataclass(frozen=True)
class MatomoReceived:
    directory: Path
    source: MatomoSourceFiles
    delivery: DatasetDelivery
    archive_sha256: str

    def summary(self):
        return {"directory": str(self.directory), "editionId": self.source.edition_id,
            "reportCaptureId": self.source.report_capture_id, "captureId": self.source.capture_id,
            "rows": self.source.manifest["rows"], "files": len(self.source.manifest["files"]),
            "nativeRows": self.source.acquired_rows, "nativeStatus": self.source.native_status,
            "paymentStatus": self.source.payment_status, "archiveSha256": self.archive_sha256,
            "reopened": self.source.reopened}


def open_received(directory, *, node="node"):
    directory = _output(directory)
    if private_directory(directory, create=False) != directory:
        fail("OUTPUT_CANONICAL_PATH_REQUIRED")
    record = loads(read(directory / "receiving.json", 1024 * 1024))
    if record.get("schema") != _RECEIVED or not _SHA.fullmatch(record.get("archiveSha256", "")):
        fail("RECEIVING_RECORD_INVALID")
    scan = native_scan(directory / "data-room", node=node)
    original = loads(read(directory / "handover.json", 8 * 1024 * 1024))
    if ({k: v for k, v in scan.items() if k != "out"}
            != {k: v for k, v in original.get("originalScan", {}).items() if k != "out"}):
        fail("ORIGINAL_SCAN_CHANGED")
    delivery = DatasetDelivery.from_finalized_scan(scan)
    evidence, evidence_members = operator_evidence(delivery, directory / "operator-pages")
    if (evidence != original.get("operatorEvidence") or evidence_members != [item for item in original["files"] if item["path"].startswith("operator-pages/")]):
        fail("OPERATOR_EVIDENCE_CHANGED")
    source = MatomoSourceFiles.from_dataset(delivery, directory / "source",
        expected_capture_id=record["captureId"], edition_id=record["editionId"],
        report_capture_id=record["reportCaptureId"])
    return MatomoReceived(directory, source, delivery, record["archiveSha256"])


def receive_archive(archive_path, destination, *, node="node"):
    archive_path, destination = _output(archive_path), _output(destination)
    pin = _sha_file(archive_path)
    if destination.exists() or destination.is_symlink():
        result = open_received(destination, node=node)
        if result.archive_sha256 != pin["sha256"]:
            fail("RECEIVING_ARCHIVE_CONFLICT")
        return result
    stage = Path(tempfile.mkdtemp(prefix=".matomo-native-receive-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if (len(names) > 8200 or len(set(names)) != len(names) or "handover.json" not in names
                    or sum(item.file_size for item in entries) > _MAX
                    or any(item.flag_bits & 1 or item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                           or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16) for item in entries)):
                fail("HANDOVER_ARCHIVE_INVALID")
            metadata = archive.getinfo("handover.json")
            if metadata.file_size > 8 * 1024 * 1024:
                fail("HANDOVER_MANIFEST_TOO_LARGE")
            manifest_raw = archive.read(metadata)
            manifest = loads(manifest_raw)
            if (manifest.get("schema") != _ARCHIVE or manifest.get("sourceFormat") != "SF100_SCAN"
                    or not isinstance(manifest.get("files"), list)):
                fail("HANDOVER_MANIFEST_INVALID")
            expected = {}
            for item in manifest["files"]:
                name = item.get("path")
                if not isinstance(name, str):
                    fail("HANDOVER_MEMBER_INVALID")
                if name.startswith("data-room/"):
                    _native_name(name.removeprefix("data-room/"))
                else:
                    _evidence_name(name)
                if name in expected or type(item.get("bytes")) is not int or not 0 <= item["bytes"] <= _MAX or not _SHA.fullmatch(item.get("sha256", "")):
                    fail("HANDOVER_MEMBER_INVALID")
                expected[name] = item
            if set(names) != {"handover.json"} | expected.keys():
                fail("HANDOVER_INVENTORY_CHANGED")
            for name in names:
                target = stage / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                size, checksum = 0, hashlib.sha256()
                limit = metadata.file_size if name == "handover.json" else expected[name]["bytes"]
                with os.fdopen(fd, "wb") as output, archive.open(name) as source:
                    while chunk := source.read(1024 * 1024):
                        size += len(chunk)
                        if size > limit:
                            fail("HANDOVER_MEMBER_SIZE_CHANGED")
                        output.write(chunk)
                        checksum.update(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if size != limit or name != "handover.json" and checksum.hexdigest() != expected[name]["sha256"]:
                    fail("HANDOVER_MEMBER_CHANGED")
        scan = native_scan(stage / "data-room", node=node)
        if ({k: v for k, v in scan.items() if k != "out"}
                != {k: v for k, v in manifest["originalScan"].items() if k != "out"}):
            fail("ORIGINAL_SCAN_CHANGED")
        delivery = DatasetDelivery.from_finalized_scan(scan)
        evidence, evidence_members = operator_evidence(delivery, stage / "operator-pages")
        if (evidence != manifest.get("operatorEvidence") or evidence_members != [item for item in manifest["files"] if item["path"].startswith("operator-pages/")]):
            fail("OPERATOR_EVIDENCE_CHANGED")
        source = MatomoSourceFiles.from_dataset(delivery, stage / "source")
        record = {"schema": _RECEIVED, "archiveSha256": pin["sha256"], "archiveBytes": pin["bytes"],
                  "captureId": source.capture_id, "editionId": source.edition_id,
                  "reportCaptureId": source.report_capture_id,
                  "paymentStatus": delivery.payment_status}
        fd = os.open(stage / "receiving.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(_json(record))
            output.flush()
            os.fsync(output.fileno())
        if _sha_file(archive_path) != pin:
            fail("HANDOVER_ARCHIVE_CHANGED")
        os.rename(stage, destination)
        stage = None
        sync_directory(destination.parent)
        return open_received(destination, node=node)
    except (zipfile.BadZipFile, KeyError, TypeError):
        fail("HANDOVER_ARCHIVE_INVALID")
    finally:
        if stage is not None:
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pack", "receive", "reopen", "from-scan", "rows"])
    parser.add_argument("--scan")
    parser.add_argument("--archive")
    parser.add_argument("--operator-evidence")
    parser.add_argument("--out", required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.command == "pack":
        if not args.scan:
            parser.error("--scan is required")
        if not args.operator_evidence:
            parser.error("--operator-evidence is required for the original per-page operator records")
        result = pack_scan(loads(read(_output(args.scan), 16 * 1024 * 1024)), args.out,
                           evidence_directory=_output(args.operator_evidence))
    elif args.command == "receive":
        if not args.archive:
            parser.error("--archive is required")
        result = receive_archive(args.archive, args.out, node=args.node).summary()
    elif args.command == "from-scan":
        if not args.scan:
            parser.error("--scan is required")
        delivery = DatasetDelivery.from_finalized_scan(loads(read(_output(args.scan), 16 * 1024 * 1024)))
        source = MatomoSourceFiles.from_dataset(delivery, args.out)
        result = {"directory": str(source.directory), "captureId": source.capture_id,
                  "editionId": source.edition_id, "reportCaptureId": source.report_capture_id,
                  "rows": source.manifest["rows"], "files": len(source.manifest["files"]),
                  "paymentStatus": source.payment_status, "nativeStatus": source.native_status,
                  "reopened": source.reopened}
    else:
        received = open_received(args.out, node=args.node)
        if args.command == "rows":
            import sys
            for row in received.source.rows():
                sys.stdout.buffer.write(row.original)
            return
        result = received.summary()
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except MatomoDeliveryError as error:
        print(json.dumps({"error": error.code, "details": error.details}))
        raise SystemExit(2)
