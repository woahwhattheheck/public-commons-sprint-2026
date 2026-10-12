#!/usr/bin/env python3
"""Reassemble the exact original Woo ERP source archive from its retained text parts."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

SOURCE = "b39da9bbf56ef4bdbd8d81513966ac636fed6c7a"
ARCHIVE = {
    "bytes": 3315202,
    "sha256": "992c0d8901d0fef531e7f9cfb4b7fdd928423f897f7dcd7d4c4b5eccf181001f",
    "gitBlob": "70afac7386df552e0c91d015357f2794a3759be3",
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
    if (manifest.get("schema") != "stellar-forge.woo-erp.source-parts.v1"
            or manifest.get("sourceCommit") != SOURCE
            or manifest.get("encoding") != "base64"
            or any(manifest.get("archive", {}).get(key) != value for key, value in ARCHIVE.items())
            or len(manifest.get("parts", [])) != 6):
        raise ValueError("Select the complete original b39 source parts")
    if destination.exists() or destination.is_symlink():
        return {"file": str(destination), **archive_identity(destination), "reused": True}
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.parent.resolve() != destination.parent:
        raise ValueError("Use an exact archive destination without symlink ancestors")
    fd, name = tempfile.mkstemp(prefix=".woo-source-", suffix=".pending", dir=destination.parent)
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
