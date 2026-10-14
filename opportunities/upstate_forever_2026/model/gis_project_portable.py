"""Portable storage for the existing editable GIS package, without model changes.

Scientific creation, rendering, editing and verification remain in gis_project.
All native publication, path and locking behavior comes from portable_fs. This
module ships beside those complete original tools in each newly built package.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile
import unicodedata
import uuid
import zipfile

from . import portable_fs as fs

BLOCK = 1024 * 1024
native_path = fs.native_path


def _gis():
    from . import gis_project
    return gis_project


def member(name):
    return fs.relative_name(name, windows=True)


def validate_members(names):
    fs.validate_members(names, portable=True)


def locked(path):
    return fs.locked(path, blocking=False)


def save(path, body):
    """Durably replace a mutable JSON record after closing its writable handle."""
    path = fs.native_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(".gis-record-" + uuid.uuid4().hex)
    try:
        descriptor = fs.open_file(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(descriptor, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        fs.replace(pending, path)
        fs.sync_directory(path.parent)
    finally:
        pending.unlink(missing_ok=True)


def copy_checked(source_root, record, target):
    """Retain original bytes with create-only, verified-copy-capable publication."""
    gis = _gis()
    source = gis.checked(fs.native_path(source_root), record)
    target = fs.native_path(target)
    target.parent.mkdir(parents=True, exist_ok=True)

    def matches():
        if target.is_symlink() or not target.is_file():
            return False
        info = fs.path_stat(target)
        return info.st_size == record["bytes"] and gis.sha256(target) == record["sha256"]

    if target.exists():
        if matches():
            return
        raise ValueError("Retained staged original changed: " + str(target))
    pending = target.with_name(".gis-copy-" + uuid.uuid4().hex)
    try:
        incoming = fs.open_file(source, os.O_RDONLY)
        with os.fdopen(incoming, "rb") as reader:
            outgoing = fs.open_file(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
            with os.fdopen(outgoing, "wb") as writer:
                shutil.copyfileobj(reader, writer, BLOCK)
                writer.flush()
                os.fsync(writer.fileno())
        if pending.stat().st_size != record["bytes"] or gis.sha256(pending) != record["sha256"]:
            raise ValueError("Input changed during copy: " + record["path"])
        try:
            fs.publish_file(pending, target)
        except FileExistsError:
            if not matches():
                raise ValueError("Retained staged original changed: " + str(target))
        fs.sync_directory(target.parent)
    finally:
        pending.unlink(missing_ok=True)


def sync_tree(root):
    """Flush completed GIS writers only after their native provider handles close."""
    root = fs.native_path(root)
    directories = [root]
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("A symbolic link is not a retained GIS member")
        if path.is_dir():
            directories.append(path)
        elif path.is_file():
            descriptor = fs.open_file(path, os.O_RDWR)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        else:
            raise ValueError("A nonregular file is not a retained GIS member")
    for directory in sorted(directories, key=lambda p: len(p.parts), reverse=True):
        fs.sync_directory(directory)


def publish_directory(staging, destination):
    sync_tree(staging)
    fs.publish_directory(staging, destination)


def _entries(archive):
    """Validate the whole Windows/Mac namespace before creating any member."""
    files, names, prefixes = [], set(), {}
    for entry in archive.infolist():
        directory = entry.is_dir()
        name = entry.filename[:-1] if directory else entry.filename
        member(name)
        if entry.filename in names:
            raise ValueError("Duplicate GIS archive member: " + entry.filename)
        names.add(entry.filename)
        mode = entry.external_attr >> 16
        permitted = (0, stat.S_IFDIR) if directory else (0, stat.S_IFREG)
        if stat.S_IFMT(mode) not in permitted:
            raise ValueError("Archive contains a nonregular member")
        if entry.flag_bits & 1:
            raise ValueError("Encrypted members are not supported")
        parts = name.split("/")
        for count in range(1, len(parts) + 1):
            prefix = "/".join(parts[:count])
            key = unicodedata.normalize("NFC", prefix).casefold()
            kind = "directory" if directory or count < len(parts) else "file"
            previous = prefixes.get(key)
            if previous is not None and previous != (prefix, kind):
                raise ValueError("Conflicting GIS member names: " + previous[0] + " / " + prefix)
            prefixes[key] = (prefix, kind)
        if not directory:
            files.append(entry)
    fs.validate_members([entry.filename for entry in files], portable=True)
    if not {"inventory.json", "project.json", "project.qgs", "project.qgz"} <= {
            entry.filename for entry in files}:
        raise ValueError("Archive lacks the editable GIS project")
    return files


def _stream_hash(stream):
    stream.seek(0)
    digest = hashlib.sha256()
    while block := stream.read(BLOCK):
        digest.update(block)
    return digest.hexdigest()


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def pack(root, destination):
    """Pack the original complete inventory and publish without replacing an edition."""
    gis = _gis()
    root = fs.native_path(Path(root).resolve(strict=True))
    destination = fs.native_path(Path(destination).resolve())
    result = gis.verify(root)
    if destination.is_relative_to(root):
        raise ValueError("Write the GIS archive outside its inventoried source directory")
    inventory_body = (root / "inventory.json").read_bytes()
    captured = gis.load(root / "inventory.json")
    if captured["fingerprint"] != result["fingerprint"]:
        raise ValueError("GIS inventory changed before packing")
    names = [record["path"] for record in captured["files"]] + ["inventory.json"]
    fs.validate_members(names, portable=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.with_name(".gis-archive-" + uuid.uuid4().hex)
    try:
        descriptor = fs.open_file(pending, os.O_RDWR | os.O_CREAT | os.O_EXCL)
        with os.fdopen(descriptor, "w+b") as stream:
            with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                for name in sorted(names):
                    archive.write(gis.local(root, name), name)
            stream.flush()
            os.fsync(stream.fileno())
            stream.seek(0)
            with zipfile.ZipFile(stream) as archive:
                entries = _entries(archive)
                if {entry.filename for entry in entries} != set(names):
                    raise ValueError("Packed GIS member population changed")
                if archive.read("inventory.json") != inventory_body:
                    raise ValueError("GIS inventory changed while packing")
                for record in captured["files"]:
                    digest, size = hashlib.sha256(), 0
                    with archive.open(record["path"]) as incoming:
                        while block := incoming.read(BLOCK):
                            digest.update(block)
                            size += len(block)
                    if size != record["bytes"] or digest.hexdigest() != record["sha256"]:
                        raise ValueError("Retained file changed during packing: " + record["path"])
            digest = _stream_hash(stream)
            size = os.fstat(stream.fileno()).st_size
        # The writable ZIP descriptor is CLOSED before Win32 publication.
        reused = False
        try:
            fs.publish_file(pending, destination)
        except FileExistsError:
            descriptor = fs.open_file(destination, os.O_RDONLY)
            with os.fdopen(descriptor, "rb") as existing:
                if os.fstat(existing.fileno()).st_size != size or _stream_hash(existing) != digest:
                    raise FileExistsError("Destination contains a different GIS archive")
            reused = True
        fs.sync_directory(destination.parent)
        return {**result, "archive": str(destination), "bytes": size,
                "sha256": digest, "reused": reused}
    finally:
        pending.unlink(missing_ok=True)


def receive(archive, destination):
    """Receive one verified original edition through native create-only publication."""
    gis = _gis()
    archive = fs.native_path(Path(archive).resolve(strict=True))
    destination = fs.native_path(Path(destination).resolve())
    if destination.exists():
        raise FileExistsError("Choose a new receiving directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = None
    try:
        descriptor = fs.open_file(archive, os.O_RDONLY)
        with os.fdopen(descriptor, "rb") as stream:
            original = fs.fd_stat(stream.fileno())
            with zipfile.ZipFile(stream) as incoming:
                entries = _entries(incoming)
                total = sum(entry.file_size for entry in entries)
                if total > shutil.disk_usage(destination.parent).free:
                    raise OSError("Receiving volume lacks space for the complete uncompressed GIS project")
                staging = Path(tempfile.mkdtemp(prefix=".gis-receiving-", dir=destination.parent))
                for entry in entries:
                    with fs.parent_directory(staging, entry.filename, create=True) as (parent, name):
                        outgoing = parent.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                        with os.fdopen(outgoing, "wb") as writer, incoming.open(entry) as reader:
                            shutil.copyfileobj(reader, writer, BLOCK)
                            writer.flush()
                            os.fsync(writer.fileno())
                        parent.sync()
            archive_digest = _stream_hash(stream)
            if _identity(original) != _identity(fs.fd_stat(stream.fileno())):
                raise ValueError("Original GIS archive changed during receiving")
        result = gis.verify(staging)
        with locked(destination.parent / ("." + destination.name + ".lock")):
            if destination.exists():
                raise FileExistsError("Receiving destination was created by another operation")
            # Native no-replace also handles a noncooperating concurrent writer.
            fs.sync_directory(staging)
            fs.publish_directory(staging, destination)
        return {**result, "directory": str(destination), "archive_sha256": archive_digest}
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)
