#!/usr/bin/env python3
"""MIT. Receive the complete original OECD source and launch its existing operation."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

APPLICATION_COMMIT = "02e086a1feeb551a1531f573d2affe7eb40a818e"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
RECEIVER_SHA256 = "fedc33b92a755fe6e0cdbe7fe9a06f53c7bc19ab49e8115ea2d51512b4025c58"
PRODUCT = Path("stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd")
SELECTION = Path("receiving_operations/scf-oecd-leading-indicators-20261012/SOURCE_SELECTION.json")
MAX_INDEX_BYTES = 2 * 1024 * 1024

def require(condition, message):
    if not condition:
        raise ValueError(message)

def exact_path(value, *, directory=False, exists=True):
    path = Path(value)
    require(path.is_absolute(), "Use an absolute original path: " + value)
    require(path.resolve(strict=exists) == path, "Use the original resolved path: " + value)
    if exists:
        require(path.is_dir() if directory else stat.S_ISREG(path.stat().st_mode),
                "Original path has the wrong type: " + value)
    return path

def original_file(path, limit):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
            "Use the bounded complete original file: " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        current = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size) ==
                (current.st_dev, current.st_ino, current.st_size),
                "Original input changed while opening")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            body = stream.read(limit + 1)
        after = os.fstat(fd)
        require(len(body) == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "Original input changed while reading")
        return body
    finally:
        os.close(fd)

def write_original(path, body):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.parent.resolve() == path.parent, "Original output directory was redirected")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(original_file(path, max(len(body), 1)) == body,
                "Resume this launch with its original binding: " + str(path))
        return
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)

def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

def executable(value):
    found = shutil.which(value)
    require(found is not None, "Use the existing executable: " + value)
    path = Path(found).resolve(strict=True)
    require(path.is_file() and os.access(path, os.X_OK), "Existing executable is not runnable")
    return str(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-transfer", required=True, help="Original complete transfer index beside its ZIP files")
    parser.add_argument("--commit", required=True, help="Exact selected-source projection commit from the transfer")
    parser.add_argument("--receiver", required=True, help="Complete original git-object-receiving.py downloaded with this handover")
    parser.add_argument("--cache", required=True, help="New or same owned native source cache")
    parser.add_argument("--source", required=True, help="New or same materialized OECD source directory")
    parser.add_argument("--project", required=True, help="New or same original private OECD project")
    parser.add_argument("--node-modules", required=True, help="Existing equipped runtime node_modules, read through a source-root binding")
    parser.add_argument("--node", default="node")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--git", default="git")
    parser.add_argument("--mode", choices=("briefing", "receive", "serve"), default="briefing")
    parser.add_argument("--operation", default="scf-oecd-cli-briefing-20261012",
                        help="Original source-only example operation; retain it on continuation")
    parser.add_argument("--config", help="Original configured merchant/buyer receiving file for receive mode")
    args = parser.parse_args()
    os.umask(0o077)
    transfer = exact_path(args.source_transfer)
    transfer_body = original_file(transfer, MAX_INDEX_BYTES)
    index = json.loads(transfer_body)
    identity = index.get("source", {})
    require(index.get("schema") == "stellar-forge.git-source-transfer.v1" and
            identity.get("repository") == REPOSITORY and identity.get("commit") == args.commit,
            "Explicit original transfer repository/commit differs")
    receiver = exact_path(args.receiver)
    require(hashlib.sha256(original_file(receiver, 128 * 1024)).hexdigest() == RECEIVER_SHA256,
            "Use the complete unchanged maintained Git receiver from this handover")
    cache = exact_path(args.cache, directory=True, exists=False)
    source = exact_path(args.source, directory=True, exists=False)
    project = exact_path(args.project, directory=True, exists=False)
    require(cache != source and cache != project and source != project,
            "Use distinct original source cache, source and project directories")
    require(not project.is_relative_to(source) and not source.is_relative_to(project),
            "Keep the retained project separate from its installed source")
    modules = exact_path(args.node_modules, directory=True)
    node, python, git = executable(args.node), executable(args.python), executable(args.git)
    config = None
    config_sha256 = None
    if args.mode == "receive":
        require(args.config, "Receive mode requires the original configured merchant/buyer file")
        config = exact_path(args.config)
        config_sha256 = hashlib.sha256(original_file(config, 1024 * 1024)).hexdigest()
    else:
        require(args.config is None, "--config belongs to the configured native receive operation")
    require(1 <= len(args.operation) <= 110, "Use the original source-only operation identity")
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The maintained receiver owns the cache root and its first-empty-directory check.
    source_command = [python, str(receiver), "--source-transfer", str(transfer),
                      "--commit", args.commit, "--directory", str(cache),
                      "--materialize", str(source), "--git", git]
    received = subprocess.run(source_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              shell=False, check=False)
    if received.stdout:
        sys.stdout.buffer.write(received.stdout)
        sys.stdout.buffer.flush()
    if received.stderr:
        sys.stderr.buffer.write(received.stderr)
        sys.stderr.buffer.flush()
    if received.returncode:
        return received.returncode
    native = json.loads(received.stdout)
    require(native.get("phase") == "OBJECTS_AVAILABLE" and native.get("missingObjects") == 0 and
            native.get("source", {}).get("commit") == args.commit and
            native.get("sourceDirectory") == str(source),
            "Complete original source has not materialized")
    selected = json.loads(original_file(source / SELECTION, MAX_INDEX_BYTES))
    require(selected.get("applicationSource", {}).get("repository") == REPOSITORY and
            selected.get("applicationSource", {}).get("commit") == APPLICATION_COMMIT,
            "Received projection does not contain this original OECD application")
    module_binding = source / "node_modules"
    try:
        os.symlink(modules, module_binding, target_is_directory=True)
    except FileExistsError:
        require(module_binding.resolve(strict=True) == modules,
                "Retain the existing original runtime module binding")
    project.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(project.resolve() == project, "Original project directory was redirected")
    product = source / PRODUCT
    if args.mode == "briefing":
        command = [node, str(product / "examples/create-briefing.mjs"),
                   "--project", str(project), "--python", python, "--operation", args.operation]
    else:
        command = [node, str(product / "cli.mjs"), args.mode,
                   "--project", str(project), "--python", python]
        if config:
            command += ["--config", str(config)]
    binding = {"schema": "stellar-forge.oecd-native-launch.v1", "mode": args.mode,
               "applicationSource": selected["applicationSource"], "receivedSource": identity,
               "transferSha256": hashlib.sha256(transfer_body).hexdigest(),
               "sourceDirectory": str(source), "projectDirectory": str(project),
               "nodeModules": str(modules), "command": command,
               "configurationSha256": config_sha256}
    write_original(cache / "oecd-launch" / (args.mode + ".json"), json_bytes(binding))
    # Preserve the original program's stdout, signals, lifetime and operation journal.
    # There is no wrapper retry or payment replay; the original receiver owns continuation.
    os.execve(node, command, {**os.environ, "SF30_XML_NODE": node, "SF30_OECD_PYTHON": python})
    return 1

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
