#!/usr/bin/env python3
"""Materialize the complete original Eurostat application and launch its receiver.

Uses Python's standard library on Linux. The retained application owns native
publication, payment, accounting, delivery, and same-project continuation.
"""
import argparse
import base64
import binascii
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import uuid

PACKET_SCHEMA = "stellar-forge.eurostat-source-packet.v1"
INSTALL_SCHEMA = "stellar-forge.eurostat-source-installation.v1"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
SOURCE_COMMIT = "5bd4acb39c2012d0cf64c7efc93572416e0224a6"
OPERATION = "SCF-EUROSTAT-ECONOMIC-WORKSPACE-20261012"
ENTRYPOINT = "stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/cli.mjs"
MANIFEST = ".eurostat-source-installation.json"
LOCK = ".eurostat-source-installation.lock"
MAX_PACKET_BYTES = 64 * 1024 * 1024


class SourceError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise SourceError(message)


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data):
    header = ("blob " + str(len(data)) + "\0").encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON member: " + key)
        result[key] = value
    return result


def parse_json(data):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as exc:
        raise SourceError("Invalid UTF-8 JSON: " + str(exc)) from exc


def relative_path(value):
    require(isinstance(value, str) and value, "A source path is empty")
    require("\0" not in value and "\\" not in value, "Invalid source path: " + value)
    require(not value.startswith("/") and ":" not in value, "Source path is not relative: " + value)
    parts = value.split("/")
    require(all(part not in ("", ".", "..") for part in parts), "Unsafe source path: " + value)
    require(parts[0] not in (MANIFEST, LOCK, "node_modules"), "Reserved source path: " + value)
    require(str(PurePosixPath(value)) == value, "Source path is not normalized: " + value)
    return parts


def verified_packet(path, expected_sha256):
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha256 or "") is not None,
            "--sha256 must be the published complete packet SHA256")
    with open(path, "rb") as handle:
        raw = handle.read(MAX_PACKET_BYTES + 1)
    require(len(raw) <= MAX_PACKET_BYTES, "Source packet exceeds 64 MiB")
    require(sha256(raw) == expected_sha256, "Complete source packet SHA256 differs")
    packet = parse_json(raw)
    require(isinstance(packet, dict), "Source packet must be an object")
    require(packet.get("schema") == PACKET_SCHEMA, "Source packet schema differs")
    require(packet.get("repository") == REPOSITORY, "Source repository differs")
    require(packet.get("source_commit") == SOURCE_COMMIT, "Original source commit differs")
    require(packet.get("operation_id") == OPERATION, "Source operation differs")
    require(packet.get("entrypoint") == ENTRYPOINT, "Native entrypoint differs")
    entries = packet.get("files")
    require(isinstance(entries, list) and 0 < len(entries) <= 10000, "Invalid source file list")
    require(packet.get("file_count") == len(entries), "Source file count differs")
    decoded = []
    seen = set()
    total = 0
    for entry in entries:
        require(isinstance(entry, dict), "Source file entry must be an object")
        name = entry.get("path")
        relative_path(name)
        require(name not in seen, "Duplicate source path: " + name)
        require(entry.get("mode") in ("100644", "100755"), "Unsupported source mode: " + name)
        require(entry.get("encoding") == "base64", "Source encoding differs: " + name)
        require(isinstance(entry.get("content"), str), "Source body is missing: " + name)
        try:
            body = base64.b64decode(entry["content"], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise SourceError("Invalid base64 for " + name) from exc
        require(type(entry.get("bytes")) is int and entry["bytes"] == len(body),
                "Source byte count differs: " + name)
        require(sha256(body) == entry.get("sha256"), "Source SHA256 differs: " + name)
        require(git_blob_sha(body) == entry.get("git_blob_sha"), "Original Git blob differs: " + name)
        seen.add(name)
        total += len(body)
        decoded.append((entry, body))
    require(packet.get("source_bytes") == total, "Complete source byte count differs")
    require(ENTRYPOINT in seen, "Original receiving entrypoint is missing")
    for name in seen:
        parts = relative_path(name)
        require(all("/".join(parts[:n]) not in seen for n in range(1, len(parts))),
                "Source file is also another file's parent: " + name)
    roots = packet.get("roots")
    require(isinstance(roots, list) and all(name in seen for name in roots),
            "An explicit original source root is missing")
    app = packet.get("application", {})
    require(app.get("original_response") in seen, "Complete original observation response is missing")
    original = next((entry for entry, body in decoded
                     if entry["path"] == app["original_response"]), None)
    require(original["sha256"] == app.get("original_response_sha256")
            and original["bytes"] == app.get("original_response_bytes"),
            "Original observation response identity differs")
    return packet, decoded, len(raw)


def fsync_directory(path):
    descriptor = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def source_target(root, name, create=False):
    parts = relative_path(name)
    parent = root
    for part in parts[:-1]:
        parent = parent / part
        if create:
            try:
                parent.mkdir(mode=0o700)
            except FileExistsError:
                pass
        try:
            info = parent.lstat()
        except FileNotFoundError:
            return root.joinpath(*parts)
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
                "Source parent must be a real directory: " + str(parent))
    return root.joinpath(*parts)


def verify_existing(path, body):
    try:
        descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise SourceError("Cannot read original source target " + str(path) + ": " + str(exc)) from exc
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode), "Source target is not a regular file: " + str(path))
        require(info.st_size == len(body), "Existing source differs: " + str(path))
        require(handle.read(len(body) + 1) == body, "Existing source differs: " + str(path))
    return True


def write_source(root, entry, body):
    target = source_target(root, entry["path"], create=True)
    if verify_existing(target, body):
        return False
    temporary = target.parent / ("." + target.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fchmod(handle.fileno(), 0o755 if entry["mode"] == "100755" else 0o644)
            os.fsync(handle.fileno())
        try:
            os.link(str(temporary), str(target), follow_symlinks=False)
        except FileExistsError:
            require(verify_existing(target, body), "Original source target disappeared: " + str(target))
        require(verify_existing(target, body), "Original source target disappeared: " + str(target))
        fsync_directory(target.parent)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return True


def write_manifest(root, value):
    target = root / MANIFEST
    require(not target.is_symlink(), "Installation manifest must be a regular file")
    temporary = root / ("." + MANIFEST + "." + uuid.uuid4().hex + ".tmp")
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(target))
        fsync_directory(root)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def bind_node_modules(root, supplied):
    target = root / "node_modules"
    if supplied:
        supplied_path = Path(supplied)
        require(supplied_path.is_absolute(), "--node-modules must be an absolute existing directory")
        original = supplied_path.resolve(strict=True)
        require(original.is_dir(), "Original node_modules path is not a directory")
        require(original != root and root not in original.parents,
                "Original node_modules must be outside this received source tree")
        if target.is_symlink():
            require(target.resolve(strict=True) == original, "Existing node_modules binding differs")
        else:
            require(not target.exists(), "An existing local node_modules directory must be selected explicitly")
            target.symlink_to(original, target_is_directory=True)
            fsync_directory(root)
        return str(original)
    if target.is_symlink():
        original = target.resolve(strict=True)
        require(original.is_dir(), "Original node_modules binding is not a directory")
        return str(original)
    if target.exists():
        require(target.is_dir(), "Existing node_modules is not a directory")
        return str(target.resolve(strict=True))
    return None


def materialize(args, packet, decoded, packet_bytes):
    requested = Path(args.directory)
    require(requested.is_absolute(), "--directory must be an absolute source directory")
    require(not requested.is_symlink(), "Source root must be a real directory")
    requested.mkdir(mode=0o700, parents=True, exist_ok=True)
    root = requested.resolve(strict=True)
    require(root.is_dir(), "Source root must be a directory")
    lock_path = root / LOCK
    descriptor = os.open(str(lock_path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SourceError("The same source installation is active; resume its current receiver") from exc
        previous = None
        manifest_path = root / MANIFEST
        require(not manifest_path.is_symlink(), "Installation manifest must be a regular file")
        if manifest_path.exists():
            previous = parse_json(manifest_path.read_bytes())
            require(previous.get("schema") == INSTALL_SCHEMA
                    and previous.get("source_commit") == SOURCE_COMMIT
                    and previous.get("packet_sha256") == args.sha256
                    and previous.get("source_directory") == str(root),
                    "Existing installation belongs to another source packet or directory")
        # Check every existing target before the first source write.
        for entry, body in decoded:
            verify_existing(source_target(root, entry["path"]), body)
        if previous and previous.get("node_modules") and args.node_modules:
            require(str(Path(args.node_modules).resolve(strict=True)) == previous["node_modules"],
                    "Original installation node_modules binding differs")
        written = sum(1 for entry, body in decoded if write_source(root, entry, body))
        node_modules = bind_node_modules(root, args.node_modules)
        if previous and previous.get("node_modules"):
            require(node_modules == previous["node_modules"], "Original node_modules binding is missing or changed")
        installation = {
            "schema": INSTALL_SCHEMA, "operation_id": OPERATION,
            "repository": REPOSITORY, "source_commit": SOURCE_COMMIT,
            "source_directory": str(root), "packet_sha256": args.sha256,
            "packet_bytes": packet_bytes, "file_count": len(decoded),
            "source_bytes": packet["source_bytes"], "entrypoint": ENTRYPOINT,
            "installed_at": previous.get("installed_at") if previous else utc_now(),
            "verified_at": utc_now(), "node_modules": node_modules,
            "roots": packet["roots"], "application": packet["application"],
            "files": [{key: value for key, value in entry.items() if key != "content"}
                      for entry, body in decoded],
        }
        write_manifest(root, installation)
    return root, installation, written


def launch(args, root, installation):
    require(installation["node_modules"], "Select the original native runtime with --node-modules")
    config = Path(args.config)
    project = Path(args.project)
    require(config.is_absolute() and project.is_absolute(), "--config and --project must be absolute")
    require(config.is_file(), "Original private receiving configuration does not exist")
    # The application itself validates and binds the complete unchanged config.
    value = parse_json(config.read_bytes())
    require(isinstance(value, dict), "Original receiving configuration must be an object")
    require(value.get("schema") == "stellar-forge.eurostat-receiving-config.v1",
            "Original receiving configuration schema differs")
    require(isinstance(value.get("id"), str) and 0 < len(value["id"]) <= 70,
            "Original receiving configuration requires a stable operation id")
    selected = shutil.which(args.node)
    require(selected is not None, "Configured Node executable is unavailable")
    argv = [selected, str(root / ENTRYPOINT), "receive",
            "--workspace", str(project), "--input", str(config)]
    print(json.dumps({"schema": "stellar-forge.eurostat-source-launch.v1",
                      "operation_id": OPERATION, "source_commit": SOURCE_COMMIT,
                      "command": argv, "native_receiving_id": value["id"]}), flush=True)
    # Replace this process once. The native receiver owns its original checkpoint.
    os.execvpe(selected, argv, os.environ.copy())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, help="Complete published source-packet.json")
    parser.add_argument("--sha256", required=True, help="Published SHA256 of the complete packet")
    parser.add_argument("--directory", required=True, help="Absolute retained source directory")
    parser.add_argument("--node-modules", help="Existing equipped native runtime node_modules")
    parser.add_argument("--config", help="Original private Eurostat receiving configuration")
    parser.add_argument("--project", help="Original private Eurostat project directory")
    parser.add_argument("--node", default="node", help="Original Node 24 executable")
    args = parser.parse_args()
    require(bool(args.config) == bool(args.project), "--config and --project must be supplied together")
    packet, decoded, packet_bytes = verified_packet(args.bundle, args.sha256)
    root, installation, written = materialize(args, packet, decoded, packet_bytes)
    print(json.dumps({"schema": INSTALL_SCHEMA, "status": "MATERIALIZED",
                      "operation_id": OPERATION, "source_commit": SOURCE_COMMIT,
                      "source_directory": str(root), "packet_sha256": args.sha256,
                      "file_count": len(decoded), "source_bytes": packet["source_bytes"],
                      "written": written, "retained": len(decoded) - written,
                      "manifest": str(root / MANIFEST),
                      "node_modules": installation["node_modules"]}), flush=True)
    if args.config:
        launch(args, root, installation)


if __name__ == "__main__":
    try:
        main()
    except (SourceError, OSError) as exc:
        print(json.dumps({"schema": "stellar-forge.eurostat-source-error.v1",
                          "operation_id": OPERATION, "error": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr, flush=True)
        sys.exit(2)
