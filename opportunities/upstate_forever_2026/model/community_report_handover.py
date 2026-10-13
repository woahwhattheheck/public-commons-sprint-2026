"""Complete Community report handovers for the maintained source receiver."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import uuid
import zipfile

from .common import (atomic_json, canonical, describe_file, digest,
                     held, identifier, relative_file, verify_file)

SCHEMA = "upstate.community-report-handover/v1"
VERSION = 1
ROOT = "community-report-handovers"
MANIFEST = "HANDOVER.json"
RECORD = "saved-report.json"
REPORT_ARCHIVE = "community-report.zip"
BUNDLE = "community-source-handover.zip"
MEMBERS = {MANIFEST, RECORD, REPORT_ARCHIVE}
# Only the two small metadata records are read into memory. Report ZIPs stream.
MAX_METADATA_BYTES = 8 * 1024 * 1024
BLOCK_BYTES = 1024 * 1024


def _state(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _descriptor(value):
    if (not isinstance(value, dict) or type(value.get("bytes")) is not int
            or value["bytes"] < 0):
        raise ValueError("A handover member needs its original byte count and hash")
    identifier(value.get("sha256"))
    return value


def _json(body):
    try:
        value = json.loads(body)
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        canonical(value)
        return value
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError) as error:
        raise ValueError("The original handover metadata is not a valid JSON object") from error


def _member_name(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or PurePosixPath(name).is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError("Keep the original report's relative member names")
    return name


def _record_contract(record, report_id, report_sha256):
    """Validate the original registry record without adding or changing fields."""
    if (record.get("schema") != "upstate.community-reports/v1"
            or ("id" in record and record["id"] != identifier(report_id))
            or digest({key: value for key, value in record.items() if key != "id"})
               != identifier(report_id)):
        raise ValueError("The original Community report registry record changed")
    for field in ("plan_id", "table_id", "selection_id"):
        identifier(record.get(field))
    if (type(record.get("format_version")) is not int or record["format_version"] < 1
            or not isinstance(record.get("title"), str) or not record["title"].strip()):
        raise ValueError("The original report format and title are required")
    selection = {"schema": "upstate.community-report-selection/v1",
                 "plan_id": record["plan_id"], "title": record["title"],
                 "format_version": record["format_version"]}
    if digest(selection) != record["selection_id"]:
        raise ValueError("The original Community report selection changed")
    files = record.get("files")
    if (not isinstance(files, dict)
            or not {"REPORT.json", "community-report.json", REPORT_ARCHIVE} <= set(files)):
        raise ValueError("Receive the complete saved Community report inventory")
    prefix = "community-reports/" + record["selection_id"] + "/"
    for name, item in files.items():
        _member_name(name)
        _descriptor(item)
        if item.get("path") != prefix + name:
            raise ValueError("A Community report member belongs to another saved edition")
    if files["community-report.json"]["sha256"] != identifier(report_sha256):
        raise ValueError("The selected original Community report JSON changed")
    return files


def _manifest_contract(value, record):
    if (value.get("schema") != SCHEMA or type(value.get("version")) is not int
            or value["version"] != VERSION
            or digest({key: item for key, item in value.items() if key != "id"})
               != identifier(value.get("id"))):
        raise ValueError("The original source handover manifest changed")
    try:
        donor = str(uuid.UUID(value.get("original_project_id", "")))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError("The original source project UUID is required") from error
    if donor != value["original_project_id"]:
        raise ValueError("Use the exact original source project UUID")
    files = value.get("files")
    if not isinstance(files, dict) or set(files) != {RECORD, REPORT_ARCHIVE}:
        raise ValueError("Receive the original report registry record and complete report ZIP")
    for item in files.values():
        _descriptor(item)
    original = _record_contract(record, value.get("report_id"), value.get("report_sha256"))
    for field in ("title", "format_version", "plan_id", "table_id"):
        if value.get(field) != record[field]:
            raise ValueError("Handover metadata differs from its original report: " + field)
    if type(value.get("member_count")) is not int or value["member_count"] != len(original):
        raise ValueError("The original report member count changed")
    if any(files[REPORT_ARCHIVE][field] != original[REPORT_ARCHIVE][field]
           for field in ("bytes", "sha256")):
        raise ValueError("The handover names another original report ZIP")


def _stream(source, target=None, expected=None):
    checksum, total = hashlib.sha256(), 0
    while True:
        block = source.read(BLOCK_BYTES)
        if not block:
            break
        total += len(block)
        if expected is not None and total > expected["bytes"]:
            raise ValueError("A handover member exceeds its original byte count")
        checksum.update(block)
        if target is not None:
            target.write(block)
    result = {"bytes": total, "sha256": checksum.hexdigest()}
    if expected is not None and any(result[key] != expected[key] for key in result):
        raise ValueError("A complete original handover member changed")
    return result


def _read_metadata(bundle, name, expected=None):
    member = bundle.getinfo(name)
    if member.file_size > MAX_METADATA_BYTES:
        raise ValueError("A source handover metadata record exceeds 8 MiB")
    with bundle.open(member) as original:
        body = original.read(MAX_METADATA_BYTES + 1)
    if len(body) != member.file_size:
        raise ValueError("The handover metadata byte count changed")
    if expected is not None and (len(body) != expected["bytes"]
            or hashlib.sha256(body).hexdigest() != expected["sha256"]):
        raise ValueError("The original saved report record changed")
    return _json(body)


@contextlib.contextmanager
def _opened(path, expected_sha256=None):
    path = Path(path).absolute()
    if path.is_symlink():
        raise ValueError("Receive a source handover as an original regular file")
    if expected_sha256 is not None:
        identifier(expected_sha256)
    with path.open("rb") as original:
        before = os.fstat(original.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Receive a source handover as an original regular file")
        descriptor = _stream(original)
        if expected_sha256 is not None and descriptor["sha256"] != expected_sha256:
            raise ValueError("The uploaded source handover changed; select its original file")
        original.seek(0)
        try:
            with zipfile.ZipFile(original) as bundle:
                entries = bundle.infolist()
                names = [entry.filename for entry in entries]
                if len(names) != len(MEMBERS) or set(names) != MEMBERS:
                    raise ValueError("A source handover contains its three complete original members")
                for entry in entries:
                    mode = (entry.external_attr >> 16) & 0xFFFF
                    if (entry.is_dir() or entry.flag_bits & 1 or stat.S_ISLNK(mode)
                            or stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                        raise ValueError("Keep each source handover member as its original regular file")
                manifest = _read_metadata(bundle, MANIFEST)
                manifest_files = manifest.get("files")
                if not isinstance(manifest_files, dict) or set(manifest_files) != {RECORD, REPORT_ARCHIVE}:
                    raise ValueError("The source handover inventory is incomplete")
                for name, item in manifest_files.items():
                    _descriptor(item)
                    if bundle.getinfo(name).file_size != item["bytes"]:
                        raise ValueError("A source handover member size differs from its manifest")
                record = _read_metadata(bundle, RECORD, manifest_files[RECORD])
                _manifest_contract(manifest, record)
                with bundle.open(REPORT_ARCHIVE) as archive:
                    _stream(archive, expected=manifest_files[REPORT_ARCHIVE])
                if (_state(os.fstat(original.fileno())) != _state(before)
                        or _state(path.lstat()) != _state(before)):
                    raise ValueError("The original source handover changed while it was being read")
                yield original, bundle, manifest, record, descriptor
        except (zipfile.BadZipFile, NotImplementedError) as error:
            raise ValueError("The complete source handover ZIP could not be read") from error
        if (_state(os.fstat(original.fileno())) != _state(before)
                or _state(path.lstat()) != _state(before)):
            raise ValueError("The original source handover changed while it was being read")


def _summary(manifest, descriptor):
    return {key: manifest[key] for key in (
        "schema", "version", "id", "title", "original_project_id", "report_id",
        "report_sha256", "format_version", "plan_id", "table_id", "member_count")
    } | {"archive_sha256": descriptor["sha256"], "bytes": descriptor["bytes"]}


def inspect_archive(path, *, expected_sha256=None):
    """Read original source metadata without creating a project or importing data."""
    with _opened(path, expected_sha256) as (_, _bundle, manifest, _record, descriptor):
        return _summary(manifest, descriptor)


def _directory(workspace, key):
    root = workspace.root.resolve()
    directory = root / ROOT / identifier(key)
    if not directory.resolve().is_relative_to(root):
        raise ValueError("Keep the source handover inside its original Workspace")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _zip_info(name, *, stored=False):
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    return info


def export(workspace, report_id, *, report_sha256):
    """Package the exact original registry bytes and report archive once."""
    report_id, report_sha256 = identifier(report_id), identifier(report_sha256)
    report = workspace._get("community-reports", report_id)
    record_path = relative_file(workspace.root, "community-reports/" + report_id + ".json")
    if record_path.stat().st_size > MAX_METADATA_BYTES:
        raise ValueError("A source handover metadata record exceeds 8 MiB")
    record_bytes = record_path.read_bytes()
    record = _json(record_bytes)
    if {**record, "id": report_id} != report:
        raise ValueError("The original Community report registry changed")
    files = _record_contract(record, report_id, report_sha256)
    # Verify the actual saved report's full inventory before its public handover.
    paths = {name: verify_file(workspace.root, item) for name, item in files.items()}
    return _package(workspace, record_bytes, report_id, report_sha256,
                    workspace.project["id"], paths[REPORT_ARCHIVE])


def export_archive(workspace, archive_path, report_record, *, original_project_id,
                   report_sha256):
    """Package a received original report when its donor Workspace is offline."""
    from . import community_report_context as context

    # The maintained archive receiver verifies the original saved record, every
    # ZIP member and scientific context in this actual receiving Workspace.
    prepared = context.prepare_archive(
        workspace, archive_path, report_record, original_project_id=original_project_id,
        report_sha256=report_sha256, import_source=False)
    archive = verify_file(workspace.root, next(
        item for item in prepared["files"]
        if item["path"].endswith("/retained/" + REPORT_ARCHIVE)))
    original_record = archive.parent / RECORD
    if original_record.stat().st_size > MAX_METADATA_BYTES:
        raise ValueError("A source handover metadata record exceeds 8 MiB")
    record_bytes = original_record.read_bytes()
    return _package(workspace, record_bytes, prepared["community_report_id"],
                    report_sha256, original_project_id, archive)


def _package(workspace, record_bytes, report_id, report_sha256, donor, archive_path):
    record = _json(record_bytes)
    files = _record_contract(record, report_id, report_sha256)
    manifest = {
        "schema": SCHEMA, "version": VERSION, "original_project_id": donor,
        "report_id": report_id, "report_sha256": report_sha256,
        "title": record["title"], "format_version": record["format_version"],
        "plan_id": record["plan_id"], "table_id": record["table_id"],
        "member_count": len(files),
        "files": {RECORD: {"bytes": len(record_bytes), "sha256": hashlib.sha256(record_bytes).hexdigest()},
                  REPORT_ARCHIVE: {key: files[REPORT_ARCHIVE][key] for key in ("bytes", "sha256")}},
    }
    manifest["id"] = digest(manifest)
    _manifest_contract(manifest, record)
    key = manifest["id"]
    directory = _directory(workspace, key)
    path = directory / BUNDLE
    with held(workspace.root / "locks" / ("community-report-handover-" + key + ".lock")):
        if not path.exists():
            pending = None
            try:
                with tempfile.NamedTemporaryFile(dir=directory, prefix=".write-community-handover-", delete=False) as output:
                    pending = Path(output.name)
                    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
                        bundle.writestr(_zip_info(MANIFEST), canonical(manifest) + b"\n")
                        bundle.writestr(_zip_info(RECORD), record_bytes)
                        with archive_path.open("rb") as source:
                            with bundle.open(_zip_info(REPORT_ARCHIVE, stored=True), "w", force_zip64=True) as target:
                                _stream(source, target, manifest["files"][REPORT_ARCHIVE])
                    output.flush()
                    os.fsync(output.fileno())
                os.link(pending, path)
                pending.unlink()
                pending = None
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
        result = inspect_archive(path)
        if result["id"] != key:
            raise ValueError("The retained source handover differs from its original report")
        result["files"] = [describe_file(workspace.root, path, title="Community report source handover",
                                         media_type="application/zip")]
        return result


def receive(workspace, path, *, expected_sha256, delivery_id=None):
    """Receive the complete source through the original archived-report importer."""
    from . import community_report_context as context

    with _opened(path, expected_sha256) as (original, bundle, manifest, record, descriptor):
        key = manifest["id"]
        directory = _directory(workspace, key)
        with held(workspace.root / "locks" / ("community-report-handover-" + key + ".lock")):
            for name in (RECORD, REPORT_ARCHIVE):
                with bundle.open(name) as member:
                    context._archived_copy(member, directory / name, manifest["files"][name])
            original.seek(0)
            context._archived_copy(original, directory / BUNDLE, descriptor)
            atomic_json(directory / MANIFEST, manifest, immutable=True)
            # Workspace registries store the ID in their filename. The existing
            # archive receiver takes the same ID-bearing record returned by _get.
            received_record = directory / "received-report.json"
            atomic_json(received_record, {**record, "id": manifest["report_id"]}, immutable=True)
    result = context.prepare_archive(
        workspace, directory / REPORT_ARCHIVE, received_record,
        original_project_id=manifest["original_project_id"],
        report_sha256=manifest["report_sha256"], delivery_id=delivery_id)
    retained = describe_file(workspace.root, directory / BUNDLE,
                            title="Original Community source handover", media_type="application/zip")
    result["handover"] = {**_summary(manifest, descriptor), "file": retained}
    result["files"] = [*result["files"], retained]
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace")
    commands = parser.add_subparsers(dest="command", required=True)
    exporting = commands.add_parser("export")
    exporting.add_argument("report_id")
    exporting.add_argument("--report-sha256", required=True)
    packing = commands.add_parser("pack-archive")
    packing.add_argument("archive", type=Path)
    packing.add_argument("--report-record", type=Path, required=True)
    packing.add_argument("--original-project-id", required=True)
    packing.add_argument("--report-sha256", required=True)
    inspecting = commands.add_parser("inspect")
    inspecting.add_argument("archive", type=Path)
    inspecting.add_argument("--sha256", required=True)
    receiving = commands.add_parser("receive")
    receiving.add_argument("archive", type=Path)
    receiving.add_argument("--sha256", required=True)
    receiving.add_argument("--delivery-id")
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = inspect_archive(args.archive, expected_sha256=args.sha256)
    else:
        if not args.workspace:
            parser.error("--workspace is required for export, pack-archive and receive")
        from .workspace import Workspace
        workspace = Workspace(args.workspace)
        if args.command == "export":
            result = export(workspace, args.report_id, report_sha256=args.report_sha256)
        elif args.command == "pack-archive":
            result = export_archive(workspace, args.archive, args.report_record,
                                    original_project_id=args.original_project_id,
                                    report_sha256=args.report_sha256)
        else:
            result = receive(workspace, args.archive, expected_sha256=args.sha256,
                             delivery_id=args.delivery_id)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
