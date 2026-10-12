#!/usr/bin/env python3
"""Reassemble the exact original NDJSON file-job source archive from its retained text parts."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

SOURCE = "1d01fe16eb66d06a18a61e59f7a66d859cc5caa3"
OPERATION = "SCF-NDJSON-FILE-JOBS-3AD791-20261012"
ARCHIVE = {
    "bytes": 3301268,
    "sha256": "91659e8eaae0ed734041c7264bc48f675ec224fd2d8a5d4b0e447da38d04a74c",
    "gitBlob": "05a520ac1cec1844e7147cb919038ce55e84d068",
}


def regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("Expected a complete regular source file: " + str(path))
    return info


def archive_identity(path):
    regular(path, ARCHIVE["bytes"])
    sha = hashlib.sha256()
    git = hashlib.sha1(b"blob " + str(ARCHIVE["bytes"]).encode() + b"\0")
    count = 0
    with path.open("rb") as source:
        for data in iter(lambda: source.read(1024 * 1024), b""):
            count += len(data)
            sha.update(data)
            git.update(data)
    actual = {"bytes": count, "sha256": sha.hexdigest(), "gitBlob": git.hexdigest()}
    if actual != ARCHIVE:
        raise ValueError("The original source archive identity differs: " + str(path))
    return actual


def join(parts_directory, destination):
    parts = Path(parts_directory).absolute()
    destination = Path(destination).absolute()
    manifest_path = parts / "SOURCE_PARTS.json"
    regular(manifest_path, 65536)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("schema") != "stellar-forge.ndjson-file-jobs.source-parts.v1"
            or manifest.get("sourceCommit") != SOURCE
            or manifest.get("operationId") != OPERATION
            or manifest.get("encoding") != "base64"
            or any(manifest.get("archive", {}).get(key) != value for key, value in ARCHIVE.items())
            or len(manifest.get("parts", [])) != 6):
        raise ValueError("Select the complete original NDJSON file-job source parts")
    if destination.exists() or destination.is_symlink():
        return {"file": str(destination), **archive_identity(destination), "reused": True}
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.parent.resolve() != destination.parent:
        raise ValueError("Use an exact archive destination without symlink ancestors")
    fd, name = tempfile.mkstemp(prefix=".ndjson-source-", suffix=".pending", dir=destination.parent)
    temporary = Path(name)
    try:
        offset = 0
        with os.fdopen(fd, "wb") as output:
            for index, entry in enumerate(manifest["parts"], 1):
                expected_path = "archive.part-" + str(index).zfill(4) + ".b64"
                if (entry.get("part") != index or entry.get("path") != expected_path
                        or entry.get("offset") != offset):
                    raise ValueError("The original ordered source parts differ")
                path = parts / expected_path
                regular(path, 1024 * 1024 - 1)
                encoded = path.read_bytes()
                if (len(encoded) != entry["encodedBytes"] or not encoded.endswith(b"\n")
                        or hashlib.sha256(encoded).hexdigest() != entry["encodedSha256"]):
                    raise ValueError("The complete original text part differs: " + expected_path)
                raw = base64.b64decode(encoded[:-1], validate=True)
                if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                    raise ValueError("The decoded original source part differs: " + expected_path)
                output.write(raw)
                offset += len(raw)
            output.flush()
            os.fsync(output.fileno())
        actual = archive_identity(temporary)
        reused = False
        try:
            os.link(temporary, destination)
        except FileExistsError:
            archive_identity(destination)
            reused = True
        if os.name == "posix":
            directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return {"file": str(destination), **actual, "parts": 6, "reused": reused}
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parts_directory")
    parser.add_argument("destination")
    args = parser.parse_args()
    print(json.dumps(join(args.parts_directory, args.destination), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
