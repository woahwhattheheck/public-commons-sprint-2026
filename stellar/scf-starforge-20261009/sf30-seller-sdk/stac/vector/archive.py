"""Portable native vector ZIP creation and complete original-manifest receiving."""
from __future__ import annotations
import contextlib
import hashlib
import os
import stat
import tempfile
import zipfile
from pathlib import Path
from .common import (EXPORT, need, descriptor, read_json, parse_json, file_record, member,
    atomic_json, private_directory, claim, fsync_directory, MAX_DOCUMENT)
from .materialize import open_vector_export
from .comparison import COMPARISON, open_comparison

NAMES = {EXPORT: "vector-export.json", COMPARISON: "vector-comparison.json"}

def bundle_source(directory, expected_sha256=None, native=True):
    directory = Path(directory).resolve()
    if (directory / "vector-export.json").is_file():
        return open_vector_export(directory, expected_sha256, native=native)
    return open_comparison(directory, expected_sha256)

def archive_manifest(archive, expected_manifest_sha256=None):
    names, manifest_names = set(), []
    for info in archive.infolist():
        need(info.filename not in names and not info.is_dir(), "VECTOR_ARCHIVE_MEMBER_SET_INVALID")
        names.add(info.filename)
        member(Path("/"), info.filename)
        need(((info.external_attr >> 16) & 0o170000) != stat.S_IFLNK,
             "VECTOR_ARCHIVE_SYMLINK_UNSUPPORTED")
        if info.filename in NAMES.values():
            manifest_names.append(info.filename)
    need(len(manifest_names) == 1, "VECTOR_ARCHIVE_MANIFEST_REQUIRED")
    name = manifest_names[0]
    info = archive.getinfo(name)
    need(info.file_size <= MAX_DOCUMENT, "VECTOR_DOCUMENT_TOO_LARGE")
    raw = archive.read(name)
    manifest = parse_json(raw)
    need(NAMES.get(manifest.get("schema")) == name and isinstance(manifest.get("files"), list),
         "VECTOR_ARCHIVE_MANIFEST_INVALID")
    record = {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    need(expected_manifest_sha256 is None or record["sha256"] == expected_manifest_sha256,
         "VECTOR_MANIFEST_CHANGED")
    records = [descriptor(item) for item in manifest["files"]] + [record]
    need(len({item["path"] for item in records}) == len(records) and
         {item["path"] for item in records} == names, "VECTOR_ARCHIVE_MEMBER_SET_CHANGED")
    for item in records:
        need(archive.getinfo(item["path"]).file_size == item["bytes"],
             "VECTOR_ARCHIVE_MEMBER_SIZE_CHANGED", item["path"])
    return manifest, record, records

def verify_archived_member(archive, expected, output=None):
    h, size = hashlib.sha256(), 0
    with archive.open(expected["path"]) as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            need(size <= expected["bytes"], "VECTOR_ARCHIVE_MEMBER_SIZE_CHANGED", expected["path"])
            h.update(chunk)
            if output:
                output.write(chunk)
    need(size == expected["bytes"] and h.hexdigest() == expected["sha256"],
         "VECTOR_ARCHIVE_MEMBER_CHANGED", expected["path"])

def create_bundle(directory, archive_path, expected_sha256=None):
    source = bundle_source(directory, expected_sha256, native=True)
    archive_path = Path(archive_path).absolute()
    root = Path(source["directory"])
    need(not archive_path.resolve().is_relative_to(root), "VECTOR_ARCHIVE_MUST_BE_OUTSIDE_SOURCE")
    private_directory(archive_path.parent)
    if archive_path.exists():
        with zipfile.ZipFile(archive_path) as archive:
            _, record, records = archive_manifest(archive, source["manifestFile"]["sha256"])
            for item in records:
                verify_archived_member(archive, item)
        return {"path": str(archive_path), "file": file_record(archive_path),
                "manifestFile": source["manifestFile"], "replayed": True}
    fd, temporary_name = tempfile.mkstemp(prefix=".vector-bundle-", suffix=".receiving",
                                          dir=archive_path.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            records = source["manifest"]["files"] + [source["manifestFile"]]
            for record in sorted(records, key=lambda item: item["path"]):
                path = member(root, record["path"])
                h, size = hashlib.sha256(), 0
                info = zipfile.ZipInfo(record["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                with path.open("rb") as inp, archive.open(info, "w", force_zip64=True) as out:
                    for chunk in iter(lambda: inp.read(1024 * 1024), b""):
                        h.update(chunk); size += len(chunk); out.write(chunk)
                need(size == record["bytes"] and h.hexdigest() == record["sha256"],
                     "VECTOR_SOURCE_CHANGED_WHILE_READING", record["path"])
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        # link is an exclusive publish: another original package cannot be overwritten.
        try:
            os.link(temporary, archive_path)
        except FileExistsError:
            with zipfile.ZipFile(archive_path) as archive:
                _, _, records = archive_manifest(archive, source["manifestFile"]["sha256"])
                for record in records:
                    verify_archived_member(archive, record)
        fsync_directory(archive_path.parent)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(archive_path), "file": file_record(archive_path),
            "manifestFile": source["manifestFile"], "replayed": False}

def receive_bundle(archive_path, directory, expected_archive_sha256=None, expected_manifest_sha256=None):
    archive_path = Path(archive_path).resolve()
    archive_record = file_record(archive_path)
    need(expected_archive_sha256 is None or archive_record["sha256"] == expected_archive_sha256,
         "VECTOR_ARCHIVE_CHANGED")
    with zipfile.ZipFile(archive_path) as archive:
        manifest, manifest_record, records = archive_manifest(archive, expected_manifest_sha256)
        request = {"schema": "starforge.vector-archive-receive-request.v1",
                   "archiveSha256": archive_record["sha256"],
                   "manifestSha256": manifest_record["sha256"]}
        with claim(directory, request) as root:
            ordered = [item for item in records if item["path"] != manifest_record["path"]] + [manifest_record]
            for item in ordered:
                target = member(root, item["path"])
                if target.exists():
                    need(file_record(target, item["path"]) == item,
                         "VECTOR_RECEIVING_FILE_CHANGED", item["path"])
                    continue
                private_directory(target.parent)
                fd, temporary_name = tempfile.mkstemp(prefix=".vector-member-", suffix=".receiving", dir=target.parent)
                temporary = Path(temporary_name)
                try:
                    with os.fdopen(fd, "wb") as output:
                        verify_archived_member(archive, item, output)
                        output.flush(); os.fsync(output.fileno())
                    os.replace(temporary, target)
                    fsync_directory(target.parent)
                finally:
                    temporary.unlink(missing_ok=True)
            opened = bundle_source(root, manifest_record["sha256"], native=True)
            opened["archiveFile"] = archive_record
            return opened
