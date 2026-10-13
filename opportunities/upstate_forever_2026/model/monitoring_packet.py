"""Stream exact original Monitoring source members into a retained field package.

The packet keeps its original deterministic ZIP member names and metadata. Large
native files stay on disk; every streamed body must match its source descriptor.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from .monitoring_common import ContractError

CHUNK_BYTES = 1024 * 1024


def bytes_member(body):
    if not isinstance(body, bytes):
        raise TypeError("Retain canonical packet metadata as bytes")
    return {"content": body, "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest()}


def file_member(path, size, sha256):
    return {"file": Path(path), "bytes": size, "sha256": sha256}


def _member_name(name):
    path = PurePosixPath(name)
    if (not isinstance(name, str) or path.is_absolute() or not path.parts
            or path.as_posix() != name or ".." in path.parts
            or "\\" in name or "\0" in name):
        raise ContractError("The original source packet member leaves its directory")
    return name


def add_member(files, name, member):
    name = _member_name(name)
    previous = files.get(name)
    if previous is not None and any(previous[key] != member[key]
                                    for key in ("bytes", "sha256")):
        raise ContractError("Original monitoring packet members conflict")
    files[name] = member


def _identity(stat):
    return tuple(getattr(stat, field) for field in
                 ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"))


def _copy_body(member, outgoing):
    checksum, size = hashlib.sha256(), 0
    if "content" in member:
        body = member["content"]
        checksum.update(body)
        size = len(body)
        outgoing.write(body)
    else:
        path = member["file"]
        if path.is_symlink() or not path.is_file():
            raise ContractError("The original packet member must be an ordinary file")
        with path.open("rb") as incoming:
            before = os.fstat(incoming.fileno())
            for body in iter(lambda: incoming.read(CHUNK_BYTES), b""):
                checksum.update(body)
                size += len(body)
                outgoing.write(body)
            after = os.fstat(incoming.fileno())
        if _identity(before) != _identity(after):
            raise ContractError("Original source changed while streaming its packet")
    if size != member["bytes"] or checksum.hexdigest() != member["sha256"]:
        raise ContractError("Original source bytes changed while streaming their packet")


def _packet_identity(path):
    if path.is_symlink() or not path.is_file():
        raise ContractError("The retained source packet must be an ordinary file")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        checksum = hashlib.sha256()
        size = 0
        for body in iter(lambda: stream.read(CHUNK_BYTES), b""):
            checksum.update(body)
            size += len(body)
        after = os.fstat(stream.fileno())
    if _identity(before) != _identity(after) or size != after.st_size:
        raise ContractError("The retained source packet changed while being read")
    return {"path": path, "bytes": size, "sha256": checksum.hexdigest()}


def _verify_existing(path, files):
    """Recover a fully published packet after interruption before plan saving."""
    result = _packet_identity(path)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(files):
            raise ContractError("The retained campaign packet has another member inventory")
        for name, member in files.items():
            checksum, size = hashlib.sha256(), 0
            with archive.open(name) as incoming:
                for body in iter(lambda: incoming.read(CHUNK_BYTES), b""):
                    checksum.update(body)
                    size += len(body)
            if size != member["bytes"] or checksum.hexdigest() != member["sha256"]:
                raise ContractError("The retained campaign packet member differs: " + name)
    if _packet_identity(path) != result:
        raise ContractError("The retained campaign packet changed during recovery")
    return result


def retain_packet(path, files):
    """Publish one source-bound ZIP atomically, retaining an exact existing packet."""
    path = Path(path)
    files = {_member_name(name): member for name, member in files.items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        return _verify_existing(path, files)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".monitoring-packet-", suffix=".zip",
                                         dir=path.parent, delete=False) as stream:
            pending = Path(stream.name)
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, member in sorted(files.items()):
                    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    entry.external_attr = 0o100644 << 16
                    entry.file_size = member["bytes"]
                    with archive.open(entry, "w") as outgoing:
                        _copy_body(member, outgoing)
            stream.flush()
            os.fsync(stream.fileno())
        result = _packet_identity(pending)
        try:
            os.link(pending, path)
        except FileExistsError:
            result = _verify_existing(path, files)
        else:
            result["path"] = path
        pending.unlink()
        pending = None
        if os.name != "nt":
            descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return result
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
