#!/usr/bin/env python3
"""MIT. Retain the complete Kafka consumer source before original native placement."""
import argparse
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile

OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
ORIGINAL_SOURCE = "d6938e1f333d92670a653f47d136b7d7cfb3abfa"
SOURCE = "f1828c513b8c249b1dbaaf7e48e8a3e4a6c16548"
CAPSULE = "e096594571878a1b8f459923cfdc4b0ff6525b2c"
CAPSULE_NAME = "consumer-source-capsule.json"


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def relative_name(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value
            or PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts
            or PurePosixPath(value).as_posix() != value):
        raise RuntimeError("Retain an original relative source name")
    return value


def private_directory(path):
    if path.resolve(strict=True) != path:
        raise RuntimeError("Use the original canonical private directory: " + str(path))
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise RuntimeError("Use the original owned private directory: " + str(path))
    return path


def read_owned(path, limit=8 * 1024 * 1024):
    if path.resolve(strict=True) != path:
        raise RuntimeError("The retained source path contains a link: " + str(path))
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_size > limit:
            raise RuntimeError("Select the complete original owned source: " + str(path))
        data = source.read(limit + 1)
        after = os.fstat(source.fileno())
    stable = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    if len(data) != before.st_size or len(data) > limit or stable(before) != stable(after):
        raise RuntimeError("The original source changed while reading: " + str(path))
    return data


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def child_directory(root, relative):
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        try:
            current.mkdir(mode=0o700)
            sync_directory(current.parent)
        except FileExistsError:
            pass
        private_directory(current)
    return current


def same_file(path, data, mode):
    existing = read_owned(path)
    if existing != data or stat.S_IMODE(path.lstat().st_mode) != mode:
        raise RuntimeError("The retained original source differs: " + str(path))


def publish(path, data, mode=0o600, *, temporary_root):
    """Create the original bytes once; every interrupted reentry reopens them."""
    private_directory(path.parent)
    if path.exists() or path.is_symlink():
        same_file(path, data, mode)
        return
    private_directory(temporary_root)
    if temporary_root.stat().st_dev != path.parent.stat().st_dev:
        raise RuntimeError("Retain one filesystem for complete source publication")
    fd, temporary = tempfile.mkstemp(prefix=".kafka-source-" + git_blob(data) + "-", dir=temporary_root)
    try:
        with os.fdopen(fd, "wb") as output:
            fd = -1
            os.fchmod(output.fileno(), mode)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            same_file(path, data, mode)
        sync_directory(path.parent)
        same_file(path, data, mode)
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass



def clean_staging(directory, allowed):
    """Reclaim only this retained edition's unfinished private publications."""
    for path in directory.iterdir():
        match = re.fullmatch(r"\.kafka-source-([0-9a-f]{40})-[A-Za-z0-9_-]+", path.name)
        if not match or match.group(1) not in allowed:
            raise RuntimeError("Unexpected file in the original publication staging directory")
        read_owned(path)
        path.unlink()
    sync_directory(directory)


def packet_file(packet, descriptor):
    name = relative_name(descriptor.get("name"))
    if "/" in name:
        raise RuntimeError("Use the complete original flat source packet")
    data = read_owned(packet / name)
    if (git_blob(data) != descriptor.get("gitBlob")
            or len(data) != descriptor.get("bytes")):
        raise RuntimeError("The complete source packet changed: " + name)
    return data


def load_capsule(packet):
    packet = Path(packet).expanduser().absolute()
    if packet.resolve(strict=True) != packet or not packet.is_dir():
        raise RuntimeError("Select the canonical complete receiving packet")
    capsule_bytes = read_owned(packet / CAPSULE_NAME)
    if git_blob(capsule_bytes) != CAPSULE:
        raise RuntimeError("Select this complete original consumer capsule")
    capsule = json.loads(capsule_bytes)
    if (capsule.get("schema") != "stellar-forge.kafka-native-consumer-capsule.v1"
            or capsule.get("operation") != OPERATION
            or capsule.get("originalSourcePin") != ORIGINAL_SOURCE
            or capsule.get("sourcePin") != SOURCE):
        raise RuntimeError("The original consumer source selection changed")
    inventory_bytes = packet_file(packet, capsule["inventory"])
    inventory = json.loads(inventory_bytes)
    if (inventory.get("schema") != "stellar-forge.kafka-native-consumer-source.v1"
            or inventory.get("operation") != OPERATION
            or inventory.get("originalSourcePin") != ORIGINAL_SOURCE
            or inventory.get("sourcePin") != SOURCE):
        raise RuntimeError("The complete consumer inventory changed")
    files = {}
    for number, descriptor in enumerate(capsule["parts"], 1):
        part = json.loads(packet_file(packet, descriptor))
        if (part.get("schema") != "stellar-forge.kafka-native-consumer-source-part.v1"
                or part.get("operation") != OPERATION or part.get("sourcePin") != SOURCE
                or part.get("part") != number or part.get("totalParts") != len(capsule["parts"])
                or len(part.get("files", {})) != descriptor["fileCount"]):
            raise RuntimeError("Retain every original source part in its selected order")
        for name, row in part["files"].items():
            relative_name(name)
            if name in files or row.get("mode") not in ("100644", "100755"):
                raise RuntimeError("The original source inventory contains a duplicate or changed mode")
            data = row["content"].encode("utf-8")
            if (git_blob(data) != row["gitBlob"] or len(data) != row["bytes"]
                    or inventory["files"].get(name) != row["gitBlob"]):
                raise RuntimeError("The original source bytes changed: " + name)
            files[name] = {"bytes": data, "gitBlob": row["gitBlob"], "gitMode": row["mode"],
                "mode": 0o700 if row["mode"] == "100755" else 0o600}
    if (set(files) != set(inventory["files"]) or len(files) != capsule["sourceFiles"]
            or sum(len(row["bytes"]) for row in files.values()) != capsule["sourceBytes"]):
        raise RuntimeError("Retain the full selected source closure")
    helpers = {item["name"]: packet_file(packet, item) for item in capsule["helpers"]}
    if (inventory["driver"]["name"] not in helpers
            or git_blob(helpers[inventory["driver"]["name"]]) != inventory["driver"]["gitBlob"]):
        raise RuntimeError("The original receiving caller differs from its source inventory")
    return capsule, capsule_bytes, inventory_bytes, files, helpers


def inspect_source_tree(source, files, complete):
    found = set()
    if not source.exists():
        if complete:
            raise RuntimeError("The complete original source directory is absent")
        return
    private_directory(source)
    for parent, directories, names in os.walk(source, followlinks=False):
        private_directory(Path(parent))
        for name in directories:
            private_directory(Path(parent) / name)
        for name in names:
            path = Path(parent) / name
            relative = path.relative_to(source).as_posix()
            if relative not in files:
                raise RuntimeError("Unexpected file in the selected consumer source: " + relative)
            row = files[relative]
            same_file(path, row["bytes"], row["mode"])
            found.add(relative)
    if complete and found != set(files):
        raise RuntimeError("The original consumer source closure is incomplete")


def materialize(packet, root, *, verify_only=False):
    root = private_directory(Path(root).expanduser().absolute())
    capsule, capsule_bytes, inventory_bytes, files, helpers = load_capsule(packet)
    admission_bytes = read_owned(root / "native-job-input.json")
    admission = json.loads(admission_bytes)
    if (admission.get("operationId") != OPERATION or admission.get("sourcePin") != ORIGINAL_SOURCE
            or admission.get("project") != str(root)):
        raise RuntimeError("Join the same original admitted Kafka customer")
    lock_path = root / "consumer-source-materialization.lock"
    fd = os.open(lock_path, os.O_RDWR | (0 if verify_only else os.O_CREAT) | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "r+b") as lease:
        lock_info = os.fstat(lease.fileno())
        if (not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid()
                or stat.S_IMODE(lock_info.st_mode) & 0o077):
            raise RuntimeError("Retain the original source materialization owner")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source = root / "consumer-source"
        selected = {"schema": "stellar-forge.kafka-native-consumer-materialization-input.v1",
            "operation": OPERATION, "originalAdmissionSha256": digest(admission_bytes),
            "originalSourcePin": ORIGINAL_SOURCE, "sourcePin": SOURCE, "capsuleGitBlob": CAPSULE,
            "capsuleSha256": digest(capsule_bytes), "sourceInventorySha256": digest(inventory_bytes),
            "sourceFiles": len(files), "sourceBytes": capsule["sourceBytes"],
            "helpers": {name: git_blob(data) for name, data in helpers.items()}}
        source_rows = [{"path": name, "gitBlob": row["gitBlob"], "gitMode": row["gitMode"],
            "sha256": digest(row["bytes"]), "bytes": len(row["bytes"])}
            for name, row in sorted(files.items())]
        result = {"schema": "stellar-forge.kafka-native-consumer-materialization.v1",
            "operation": OPERATION, "status": "MATERIALIZED", "selection": selected,
            "sourceFiles": source_rows, "helpers": {name: {"gitBlob": git_blob(data),
                "sha256": digest(data), "bytes": len(data)} for name, data in helpers.items()}}
        selected_bytes, result_bytes = encoded(selected), encoded(result)
        allowed = {git_blob(row["bytes"]) for row in files.values()}
        allowed.update(git_blob(data) for data in helpers.values())
        allowed.update(git_blob(data) for data in
            (capsule_bytes, inventory_bytes, selected_bytes, result_bytes))
        if verify_only:
            same_file(root / "consumer-source-selection.json", selected_bytes, 0o600)
            same_file(root / CAPSULE_NAME, capsule_bytes, 0o600)
            same_file(root / capsule["inventory"]["name"], inventory_bytes, 0o600)
            for name, data in helpers.items():
                same_file(root / name, data, 0o600)
            inspect_source_tree(source, files, complete=True)
            same_file(root / "consumer-materialization.json", result_bytes, 0o600)
            staging = private_directory(root / "consumer-source-publication")
            if any(staging.iterdir()):
                raise RuntimeError("The prepared original source has unfinished publications")
            return result, result_bytes
        staging = child_directory(root, "consumer-source-publication")
        retain = lambda path, data, mode=0o600: publish(path, data, mode, temporary_root=staging)
        retain(root / "consumer-source-selection.json", selected_bytes)
        clean_staging(staging, allowed)
        inspect_source_tree(source, files, complete=False)
        child_directory(root, "consumer-source")
        for name, row in files.items():
            path = source / name
            child_directory(source, str(PurePosixPath(name).parent))
            retain(path, row["bytes"], row["mode"])
        retain(root / CAPSULE_NAME, capsule_bytes)
        retain(root / capsule["inventory"]["name"], inventory_bytes)
        for name, data in helpers.items():
            retain(root / name, data)
        inspect_source_tree(source, files, complete=True)
        retain(root / "consumer-materialization.json", result_bytes)
        clean_staging(staging, allowed)
        return result, result_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    sys.dont_write_bytecode = True
    result, data = materialize(args.packet, args.root, verify_only=args.verify_only)
    print(json.dumps({"operation": OPERATION, "status": result["status"], "sourcePin": SOURCE,
        "sourceFiles": len(result["sourceFiles"]), "bytes": result["selection"]["sourceBytes"],
        "materializationSha256": digest(data)}), flush=True)


if __name__ == "__main__":
    main()
