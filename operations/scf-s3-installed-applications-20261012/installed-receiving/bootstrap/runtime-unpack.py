#!/usr/bin/env python3
"""Unpack or verify one original Starforge release without executing its source."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

SCHEMA = "stellar-forge.merchant-distribution-manifest.v1"
PACKAGE = "@tokenjunkielabs/starforge-merchant"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_SOURCE = 64 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative_name(value):
    require(isinstance(value, str) and value and not value.startswith("/"), "Invalid release path")
    require(not any(ord(char) < 32 or ord(char) == 127 for char in value) and "\\" not in value,
            "Invalid release path")
    path = PurePosixPath(value)
    require(str(path) == value and all(part not in (".", "..", "") for part in path.parts),
            "Release paths must be normalized")
    return value


def inspect(archive, expected):
    info = archive.lstat()
    require(stat.S_ISREG(info.st_mode) and not archive.is_symlink() and info.st_size <= MAX_ARCHIVE,
            "Select a regular bounded original archive")
    require(re.fullmatch(r"[0-9a-f]{64}", expected or ""), "Expected archive SHA-256 required")
    # The same open file is hashed and parsed, so swapping the pathname cannot
    # make extraction read a different file from the one whose digest matched.
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        require(digest == expected, "Original archive SHA-256 does not match")
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode="r:gz") as tar:
            members = {}
            total = 0
            for member in tar:
                require(len(members) < 10000, "Release contains too many entries")
                name = relative_name(member.name.rstrip("/") if member.isdir() else member.name)
                require(name == "package" or name.startswith("package/"), "Unexpected archive root")
                require(name not in members, "Duplicate archive member")
                require(member.isdir() or member.isfile(), "Release links and special files are not supported")
                require(not member.sparse, "Sparse release members are not supported")
                require(0 <= member.size <= MAX_FILE, "Release member is too large")
                total += member.size
                require(total <= MAX_SOURCE, "Release exceeds the unpacked size limit")
                members[name] = member

            def content(name):
                item = members.get(name)
                require(item is not None and item.isfile(), "Required original release file is missing: " + name)
                handle = tar.extractfile(item)
                require(handle is not None, "Cannot read original release member")
                with handle:
                    data = handle.read(item.size + 1)
                require(len(data) == item.size, "Release member size changed")
                return data

            manifest_bytes = content("package/manifest.json")
            manifest = json.loads(manifest_bytes)
            metadata = json.loads(content("package/package.json"))
            require(manifest.get("schema") == SCHEMA and manifest.get("packageName") == PACKAGE,
                    "Original merchant distribution manifest required")
            require(re.fullmatch(r"[0-9a-f]{40}", manifest.get("sourceCommit", "")), "Invalid source commit")
            require(metadata.get("name") == PACKAGE and metadata.get("version") == manifest.get("packageVersion"),
                    "Package and source manifest identities differ")
            require(not metadata.get("scripts"), "Original source distribution must not contain install scripts")
            require(metadata.get("bin", {}).get("starforge") ==
                    "./source/stellar/scf-starforge-20261009/distribution/cli.mjs", "Original product entrypoint required")
            package_files = manifest.get("packageFiles")
            require(isinstance(package_files, dict) and set(package_files) == {"package.json", "README.md", "LICENSE"},
                    "Original package file map required")
            expected_files = {"manifest.json": (sha(manifest_bytes), len(manifest_bytes), 0o644)}
            for name, digest in package_files.items():
                require(re.fullmatch(r"[0-9a-f]{64}", digest or ""), "Invalid package file hash")
                data = content("package/" + name)
                require(sha(data) == digest, "Original package file changed: " + name)
                expected_files[name] = (digest, len(data), 0o644)
            files = manifest.get("files")
            require(isinstance(files, list) and 0 < len(files) < 10000, "Original source file map required")
            for item in files:
                name = relative_name(item.get("packagePath"))
                source = relative_name(item.get("path"))
                require(name == "source/" + source and name not in expected_files, "Duplicate or mismatched source path")
                require(item.get("mode") in ("100644", "100755"), "Original source must be a regular file")
                require(isinstance(item.get("bytes"), int) and 0 <= item["bytes"] <= MAX_FILE, "Invalid source size")
                require(re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", "")), "Invalid source hash")
                data = content("package/" + name)
                require(len(data) == item["bytes"] and sha(data) == item["sha256"], "Original source changed: " + source)
                if item.get("gitBlob"):
                    blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                    require(blob == item["gitBlob"], "Source Git identity changed: " + source)
                expected_files[name] = (item["sha256"], len(data), 0o755 if item["mode"] == "100755" else 0o644)
            require({name[8:] for name, item in members.items() if item.isfile()} == set(expected_files),
                    "Archive contains files outside the original manifest")
            # Retain only verified bytes. Never call tar.extract/extractall, and
            # never copy owners, symlinks, devices or permission bits from tar.
            data = {name: content("package/" + name) for name in expected_files}
            return manifest, expected_files, data, sha(manifest_bytes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    archive = Path(args.archive).absolute()
    target = Path(args.out).absolute()
    manifest, files, contents, manifest_sha = inspect(archive, args.sha256)
    if args.verify:
        require(target.is_dir() and not target.is_symlink(), "Original extracted package directory required")
        inventory = set()
        for directory, names, filenames in os.walk(target, followlinks=False):
            for name in names:
                folder = Path(directory) / name
                require(stat.S_ISDIR(folder.lstat().st_mode) and not folder.is_symlink(),
                        "Installed source contains a linked or special directory")
            for name in filenames:
                inventory.add(str((Path(directory) / name).relative_to(target)))
        require(inventory == set(files),
                "Installed source inventory differs from the archive")
    else:
        target.mkdir(mode=0o700)
    for name, (digest, length, mode) in files.items():
        file = target / name
        if args.verify:
            info = file.lstat()
            require(stat.S_ISREG(info.st_mode) and not file.is_symlink() and info.st_size == length and
                    stat.S_IMODE(info.st_mode) == mode,
                    "Installed source file differs: " + name)
            require(sha(file.read_bytes()) == digest, "Installed source bytes differ: " + name)
        else:
            file.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with file.open("xb") as output:
                output.write(contents[name])
            file.chmod(mode)
    print(json.dumps({"status": "SOURCE_VERIFIED" if args.verify else "SOURCE_UNPACKED",
                      "packageDirectory": str(target), "sourceRoot": str(target / "source"),
                      "packageName": manifest["packageName"], "packageVersion": manifest["packageVersion"],
                      "sourceCommit": manifest["sourceCommit"], "sourceFiles": len(manifest["files"]),
                      "manifestSha256": manifest_sha}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        print(json.dumps({"error": str(error)}), file=__import__("sys").stderr)
        raise SystemExit(1)
