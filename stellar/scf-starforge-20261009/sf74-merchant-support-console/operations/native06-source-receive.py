#!/usr/bin/env python3
"""Receive the exact public source for the original native06 commercial operation."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

INDEX_SCHEMA = "stellar-forge.native06-commercial-source-index.v1"
PART_SCHEMA = "stellar-forge.native06-commercial-source-part.v1"
SOURCE_SCHEMA = "stellar-forge.native06-commercial-source-manifest.v1"

def fail(message):
    raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def regular_bytes(path, maximum):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        entry = os.fstat(stream.fileno())
        if not stat.S_ISREG(entry.st_mode) or entry.st_size > maximum:
            fail("Expected a bounded original regular file: " + str(path))
        value = stream.read(maximum + 1)
        if len(value) > maximum:
            fail("Original source file exceeds its declared limit")
        return value

def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        fail("Invalid original source path")
    if value.startswith("/") or any(p in ("", ".", "..") for p in value.split("/")):
        fail("Original source paths must stay inside the selected directory")
    return value

def checked(data, row):
    if len(data) != row["bytes"] or digest(data) != row["sha256"]:
        fail("Original source byte count or SHA-256 differs")
    if "blob" in row and blob(data) != row["blob"]:
        fail("Original Git source identity differs")

def directory(path):
    if path.exists() or path.is_symlink():
        entry = path.lstat()
        if not stat.S_ISDIR(entry.st_mode):
            fail("Preserve the non-directory at " + str(path))
        return
    directory(path.parent)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        entry = path.lstat()
        if not stat.S_ISDIR(entry.st_mode):
            fail("A concurrent source parent changed")

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def inspect_existing(path, data):
    if path.exists() or path.is_symlink():
        if regular_bytes(path, len(data)) != data:
            fail("Preserve divergent existing source: " + str(path))
        return True
    return False

def retain(path, data, mode=0o600):
    if inspect_existing(path, data):
        return False
    directory(path.parent)
    temporary = path.with_name(path.name + ".receiving-" + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            inspect_existing(path, data)
        sync_directory(path.parent)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return True

def receive(index_path, expected_sha256, output, node_modules=None):
    index_path = Path(index_path).absolute()
    raw = regular_bytes(index_path, 8 * 1024 * 1024)
    if digest(raw) != expected_sha256:
        fail("Keep the exact published source index SHA-256")
    index = json.loads(raw)
    if index.get("schema") != INDEX_SCHEMA:
        fail("Unsupported original source index")
    manifest_ref = index["manifest"]
    manifest_bytes = manifest_ref["text"].encode("utf-8")
    checked(manifest_bytes, manifest_ref)
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema") != SOURCE_SCHEMA:
        fail("Unsupported original source manifest")
    rows = manifest["files"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 10000:
        fail("Expected the complete bounded original source inventory")
    by_path = {}
    for row in rows:
        name = relative(row["path"])
        if name in by_path or row.get("mode") not in ("100644", "100755"):
            fail("Repeated source path or unsupported Git mode")
        by_path[name] = row
    originals = {}
    seen_parts = set()
    if not isinstance(index["parts"], list) or not 1 <= len(index["parts"]) <= 128:
        fail("Expected the complete selected source parts")
    total = 0
    for part in index["parts"]:
        name = relative(part["path"])
        if "/" in name or name in seen_parts:
            fail("Source parts must be distinct adjacent files")
        seen_parts.add(name)
        body = regular_bytes(index_path.parent / name, 2 * 1024 * 1024)
        checked(body, part)
        total += len(body)
        if total > 64 * 1024 * 1024:
            fail("Selected source carrier is too large")
        value = json.loads(body)
        if value.get("schema") != PART_SCHEMA or value.get("sourceManifestSha256") != manifest_ref["sha256"]:
            fail("A source part belongs to another original manifest")
        for item in value["files"]:
            path = relative(item["path"])
            if path in originals or path not in by_path or not isinstance(item.get("content"), str):
                fail("Repeated or unselected source content")
            data = item["content"].encode("utf-8")
            checked(data, by_path[path])
            originals[path] = data
    if set(originals) != set(by_path):
        fail("The complete original source is not present")
    output = Path(output)
    if not output.is_absolute() or str(output) != os.path.normpath(str(output)) or str(output) == "/":
        fail("Use an absolute normalized source directory")
    # Check all existing destinations before any source publication.
    for path, data in originals.items():
        target = output / path
        parent = target.parent
        while parent != parent.parent:
            if parent.exists() or parent.is_symlink():
                if not stat.S_ISDIR(parent.lstat().st_mode):
                    fail("Preserve the non-directory source parent: " + str(parent))
            if parent == output:
                break
            parent = parent.parent
        inspect_existing(target, data)
    inspect_existing(output / "SOURCE-MANIFEST.json", manifest_bytes)
    dependency_target = None
    if node_modules is not None:
        dependency_target = Path(node_modules)
        if not dependency_target.is_absolute() or not dependency_target.is_dir():
            fail("Select an existing approved dependency installation")
        dependency_target = dependency_target.resolve(strict=True)
        destination = output / "node_modules"
        if destination.exists() or destination.is_symlink():
            if not destination.is_symlink() or destination.resolve(strict=True) != dependency_target:
                fail("Preserve the existing different node_modules selection")
    directory(output)
    written = 0
    for path, data in originals.items():
        written += int(retain(output / path, data, 0o700 if by_path[path]["mode"] == "100755" else 0o600))
    retain(output / "SOURCE-MANIFEST.json", manifest_bytes)
    if dependency_target is not None:
        destination = output / "node_modules"
        try:
            destination.symlink_to(dependency_target, target_is_directory=True)
        except FileExistsError:
            if not destination.is_symlink() or destination.resolve(strict=True) != dependency_target:
                fail("Concurrent dependency selection differs")
        sync_directory(output)
    result = {"schema": "stellar-forge.native06-commercial-source-received.v1",
              "state": "SOURCE_READY", "directory": str(output),
              "indexSha256": expected_sha256, "sourceManifestSha256": manifest_ref["sha256"],
              "files": len(originals), "bytes": sum(map(len, originals.values())),
              "sourceCommit": manifest["sourceCommit"]}
    retain(output / "SOURCE-RECEIVED.json",
           (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    if dependency_target is not None:
        dependency = {"schema": "stellar-forge.native06-commercial-source-dependencies.v1",
                      "sourceManifestSha256": manifest_ref["sha256"], "nodeModules": str(dependency_target)}
        retain(output / "SOURCE-DEPENDENCIES.json", (json.dumps(dependency, indent=2) + "\n").encode("utf-8"))
    return {**result, "nodeModules": str(dependency_target) if dependency_target else None,
            "written": written, "reused": len(originals) - written}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--node-modules")
    parser.add_argument("--run-config", help="Continue the same native06 operation after complete source receiving")
    parser.add_argument("--node", default="node", help="Existing Node executable for --run-config")
    args = parser.parse_args(argv)
    result = receive(args.index, args.expected_sha256, args.out, args.node_modules)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    if args.run_config:
        config_path = Path(args.run_config).absolute()
        config = json.loads(regular_bytes(config_path, 65536))
        if config.get("source") != result["directory"] or config.get("sourceManifestSha256") != result["sourceManifestSha256"]:
            fail("The operating configuration must select this exact received source")
        entry = Path(args.out) / "stellar/scf-starforge-20261009/sf74-merchant-support-console/operations/native06-commercial-receiving.mjs"
        return subprocess.run([args.node, str(entry), str(config_path)], check=False).returncode
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"state": "INCOMPLETE", "code": type(error).__name__, "message": str(error)}), file=sys.stderr)
        raise SystemExit(1)
