#!/usr/bin/env python3
"""Recreate the complete questionnaire project from its lossless delivery."""
from __future__ import annotations

import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

BLOCK = 1024 * 1024
SCHEMA = "atssc.lossless-customer-transport.v1"


def stream_identity(stream):
    sha, size = hashlib.sha256(), 0
    for block in iter(lambda: stream.read(BLOCK), b""):
        sha.update(block)
        size += len(block)
    return {"bytes": size, "sha256": sha.hexdigest()}


def file_identity(path):
    with Path(path).open("rb") as stream:
        return stream_identity(stream)


def safe_name(name):
    if not isinstance(name, str) or not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError("Retain the original complete delivery filename.")
    return name


def expected_identity(value):
    size, sha = value.get("bytes"), value.get("sha256")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0 or not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("The complete delivery identity is invalid.")
    return {"bytes": size, "sha256": sha}


def verify_complete(path, expected, members):
    if Path(path).is_symlink() or file_identity(path) != expected:
        raise ValueError("The complete customer project differs from its saved identity.")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != members or len(names) != len(set(names)):
            raise ValueError("The complete customer project inventory differs.")
        manifest = json.loads(archive.read("MANIFEST.json"))
        if manifest.get("schema") != "atssc.project.v1":
            raise ValueError("Use the complete original questionnaire project.")
        rows = manifest["files"]
        paths = [row["path"] for row in rows]
        if len(paths) != len(set(paths)) or set(paths) | {"MANIFEST.json"} != set(names):
            raise ValueError("The complete customer project manifest differs.")
        for row in rows:
            name = row["path"]
            if not name or "\\" in name or PurePosixPath(name).is_absolute() or ".." in name.split("/"):
                raise ValueError("The complete project contains an invalid member path.")
            with archive.open(name) as stream:
                if stream_identity(stream) != expected_identity(row):
                    raise ValueError("A complete customer project member differs: " + name)
        handover = json.loads(archive.read("HANDOVER.json"))
        if handover.get("schema") != "atssc.customer-handover.v1" or handover["workspace_id"] != manifest["workspace_id"]:
            raise ValueError("The complete customer workspace identity differs.")
        return handover["workspace_id"]


def publish_bytes(path, raw):
    path = Path(path)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != raw:
            raise ValueError("An existing different output is preserved: " + path.name)
        return
    fd, name = tempfile.mkstemp(prefix=".atssc-delivery-", dir=path.parent)
    pending = Path(name)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != raw:
                raise ValueError("An existing different output is preserved: " + path.name)
    finally:
        pending.unlink(missing_ok=True)


def receive(directory, destination=None):
    directory = Path(directory).resolve(strict=True)
    index = json.loads((directory / "TRANSPORT_MANIFEST.json").read_text())
    if index.get("schema") != SCHEMA:
        raise ValueError("Use the complete original questionnaire delivery index.")
    expected = expected_identity(index["customerZip"])
    packed_identity = expected_identity(index["compressed"])
    packed = directory / safe_name(index["compressed"]["name"])
    if packed.is_symlink() or not packed.is_file() or file_identity(packed) != packed_identity:
        raise ValueError("The complete compressed customer project differs.")
    destination = Path(destination).absolute() if destination else directory / safe_name(index["customerZip"]["name"])
    if not destination.parent.is_dir():
        raise ValueError("Choose an existing private destination directory.")
    members = index["members"]
    if not isinstance(members, int) or isinstance(members, bool) or members < 3:
        raise ValueError("The complete project member count is invalid.")
    if destination.exists() or destination.is_symlink():
        workspace_id = verify_complete(destination, expected, members)
    else:
        fd, name = tempfile.mkstemp(prefix=".atssc-project-", suffix=".zip", dir=destination.parent)
        pending = Path(name)
        sha, size = hashlib.sha256(), 0
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=512 * 1024 * 1024)
        try:
            with os.fdopen(fd, "wb") as output, packed.open("rb") as incoming:
                os.fchmod(output.fileno(), 0o600)
                for block in iter(lambda: incoming.read(BLOCK), b""):
                    if decoder.eof:
                        raise ValueError("The compressed delivery contains trailing data.")
                    current = block
                    while True:
                        decoded = decoder.decompress(current, max_length=BLOCK)
                        current = b""
                        size += len(decoded)
                        if size > expected["bytes"]:
                            raise ValueError("The complete received project exceeds its saved length.")
                        sha.update(decoded)
                        output.write(decoded)
                        if decoder.eof or decoder.needs_input:
                            break
                    if decoder.unused_data:
                        raise ValueError("The compressed delivery contains trailing data.")
                if not decoder.eof or {"bytes": size, "sha256": sha.hexdigest()} != expected:
                    raise ValueError("The complete recreated project differs from its saved identity.")
                output.flush()
                os.fsync(output.fileno())
            workspace_id = verify_complete(pending, expected, members)
            try:
                os.link(pending, destination)
            except FileExistsError:
                workspace_id = verify_complete(destination, expected, members)
        finally:
            pending.unlink(missing_ok=True)
    publish_bytes(destination.with_name(destination.name + ".sha256"), (expected["sha256"] + "  " + destination.name + "\n").encode())
    return {"status": "COMPLETE", "path": str(destination), **expected, "members": members, "workspace_id": workspace_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--output")
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(receive(args.directory, args.output)), flush=True)


if __name__ == "__main__":
    main()
