# MIT. Portable original semantic source, wheels and exact-lock receiving.
# Installed virtual environments remain owned by their original host.
from __future__ import annotations
import argparse
from contextlib import contextmanager
import email
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import uuid
import zipfile
import dcat_semantic_runtime as runtime

MANIFEST = "stellar-forge.dcat-semantic-runtime-transfer.v1"
RECEIVED = "stellar-forge.dcat-semantic-runtime-transfer-received.v1"
SELECTED = "stellar-forge.dcat-semantic-runtime-transfer-selection.v1"
MAX_MEMBERS = 20000
MAX_ARCHIVE = runtime.MAX_TOTAL + 33554432
require = runtime.require
regular = runtime.regular
encoded = runtime.encoded
sha = runtime.sha
member = runtime.member

def read_json(path, maximum=16777216):
    return json.loads(regular(path, maximum))

def outside_project(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(path),
            "SEMANTIC_RUNTIME_TRANSFER_ABSOLUTE_PATH_REQUIRED")
    for parent in (path, *path.parents):
        require(not (parent / "workbench.json").exists(),
                "SEMANTIC_RUNTIME_TRANSFER_OUTSIDE_PROJECT_REQUIRED")
    return path

def safe_parents(root, relative):
    parts = member(relative).split("/")
    current = root
    for part in parts[:-1]:
        current = current / part
        try:
            current.mkdir(mode=0o700)
        except FileExistsError:
            pass
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and not current.is_symlink() and
                info.st_uid == os.getuid() and not info.st_mode & 0o077,
                "SEMANTIC_RUNTIME_TRANSFER_PRIVATE_MEMBER_REQUIRED")
    return root.joinpath(*parts)

def write_owned(root, relative, blocks, expected):
    # Resume only an identical retained prefix beneath this bound private transfer.
    path = safe_parents(root, relative)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_uid == os.getuid() and not before.st_mode & 0o077 and
                before.st_size <= expected["bytes"],
                "SEMANTIC_RUNTIME_TRANSFER_MEMBER_EXISTS")
        old_size, position, digest = before.st_size, 0, hashlib.sha256()
        for block in blocks:
            require(isinstance(block, bytes), "SEMANTIC_RUNTIME_TRANSFER_BYTES_REQUIRED")
            require(position + len(block) <= expected["bytes"], "SEMANTIC_RUNTIME_TRANSFER_MEMBER_TOO_LARGE")
            retained = min(len(block), max(0, old_size - position))
            if retained:
                require(os.pread(fd, retained, position) == block[:retained],
                        "SEMANTIC_RUNTIME_TRANSFER_RETAINED_PREFIX_CHANGED")
            offset = retained
            while offset < len(block):
                count = os.pwrite(fd, block[offset:], position + offset)
                require(count > 0, "SEMANTIC_RUNTIME_TRANSFER_WRITE_FAILED")
                offset += count
            digest.update(block)
            position += len(block)
        require(position == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                "SEMANTIC_RUNTIME_TRANSFER_MEMBER_CHANGED")
        require(os.fstat(fd).st_size == position, "SEMANTIC_RUNTIME_TRANSFER_MEMBER_CHANGED")
        os.fchmod(fd, 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)
    runtime.sync_dir(path.parent)

def write_bytes(root, relative, raw):
    write_owned(root, relative, iter([raw]), {"bytes": len(raw), "sha256": sha(raw)})

def chunks(stream):
    while True:
        raw = stream.read(1048576)
        if not raw:
            return
        yield raw

def wheel_metadata(path):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist()
                 if name.endswith(".dist-info/METADATA") and name.count("/") == 1]
        require(len(names) == 1 and archive.getinfo(names[0]).file_size <= 1048576,
                "SEMANTIC_RUNTIME_TRANSFER_WHEEL_METADATA_INVALID")
        metadata = email.message_from_bytes(archive.read(names[0]))
    name, version = runtime.normalized_name(metadata["Name"]), metadata["Version"]
    require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9.!+_-]+", version),
            "SEMANTIC_RUNTIME_TRANSFER_WHEEL_METADATA_INVALID")
    return name, version

def payload_paths(record):
    require(isinstance(record.get("files"), list) and len(record["files"]) <= MAX_MEMBERS,
            "SEMANTIC_RUNTIME_TRANSFER_RECEIPT_INVALID")
    output = {}
    for section in ("source", "wheels"):
        inventory = record["inventories"][section]
        require(isinstance(inventory, list), "SEMANTIC_RUNTIME_TRANSFER_INVENTORY_INVALID")
        for row in inventory:
            require(row.get("kind") == "file" and row.get("mode") == 0o600,
                    "SEMANTIC_RUNTIME_TRANSFER_ORIGINAL_FILE_REQUIRED")
            path = section + "/" + member(row["path"])
            require(path not in output, "SEMANTIC_RUNTIME_TRANSFER_DUPLICATE_MEMBER")
            output[path] = {key: row[key] for key in ("bytes", "sha256")}
    for row in record["files"]:
        path = "records/" + member(row["path"])
        require(path not in output and row.get("mode") == 0o600,
                "SEMANTIC_RUNTIME_TRANSFER_RECEIPT_INVALID")
        output[path] = {key: row[key] for key in ("bytes", "sha256")}
    return output

def manifest_for(root, record):
    paths = payload_paths(record)
    receipt = regular(root / "runtime.json", 16777216)
    paths["records/runtime.json"] = {"bytes": len(receipt), "sha256": sha(receipt)}
    members = []
    for path, descriptor in sorted(paths.items()):
        original = root / (path[8:] if path.startswith("records/") else path)
        actual = runtime.file_identity(original)
        require(all(actual[key] == descriptor[key] for key in ("bytes", "sha256")),
                "SEMANTIC_RUNTIME_TRANSFER_SOURCE_CHANGED")
        members.append({"path": path, **descriptor})
    require(len(members) <= MAX_MEMBERS and sum(row["bytes"] for row in members) <= runtime.MAX_TOTAL,
            "SEMANTIC_RUNTIME_TRANSFER_LIMIT")
    return {"schema": MANIFEST, "sourceRuntimeReceiptSha256": sha(receipt),
            "source": record["source"], "lockSha256": record["lockSha256"],
            "sender": {"directory": record["directory"], "python": record["python"],
                       "createdAt": record["createdAt"]},
            "packages": read_json(root / "wheel-selection.json")["packages"],
            "files": members,
            "scope": "Original semantic source, complete resolved wheel set, exact lock and original custody receipts. No installed virtual environment or host executable is transferred."}

def validate_payload(root, manifest):
    require(manifest.get("schema") == MANIFEST and isinstance(manifest.get("files"), list),
            "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_INVALID")
    expected = {}
    for row in manifest["files"]:
        path = member(row["path"])
        require(path not in expected and path.startswith(("source/", "wheels/", "records/")) and
                isinstance(row.get("bytes"), int) and not isinstance(row["bytes"], bool) and
                0 <= row["bytes"] <= runtime.MAX_FILE and
                isinstance(row.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]),
                "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_INVALID")
        expected[path] = {"bytes": row["bytes"], "sha256": row["sha256"]}
    require(0 < len(expected) <= MAX_MEMBERS and sum(row["bytes"] for row in expected.values()) <= runtime.MAX_TOTAL,
            "SEMANTIC_RUNTIME_TRANSFER_LIMIT")
    runtime.private_directory(root)
    actual = runtime.inventory(root)
    require(len(actual) == len(expected), "SEMANTIC_RUNTIME_TRANSFER_INVENTORY_CHANGED")
    for row in actual:
        require(row.get("kind") == "file" and row["path"] in expected and row.get("mode") == 0o600 and
                all(row[key] == expected[row["path"]][key] for key in ("bytes", "sha256")),
                "SEMANTIC_RUNTIME_TRANSFER_INVENTORY_CHANGED")
    record_raw = regular(root / "records/runtime.json", 16777216)
    record = json.loads(record_raw)
    require(sha(record_raw) == manifest["sourceRuntimeReceiptSha256"] and
            record.get("schema") == runtime.SCHEMA and record.get("status") == "READY",
            "SEMANTIC_RUNTIME_TRANSFER_SENDER_RECEIPT_CHANGED")
    expected_from_record = payload_paths(record)
    expected_from_record["records/runtime.json"] = {"bytes": len(record_raw), "sha256": sha(record_raw)}
    require(expected == expected_from_record, "SEMANTIC_RUNTIME_TRANSFER_COMPLETE_RECEIPTS_REQUIRED")
    source, _ = runtime.source_selection(root / "source")
    require(source == manifest["source"] == record["source"],
            "SEMANTIC_RUNTIME_TRANSFER_ORIGINAL_SOURCE_CHANGED")
    selection_raw = regular(root / "records/selection.json", 16777216)
    selection = json.loads(selection_raw)
    require(sha(selection_raw) == record["selectionSha256"] and selection["source"] == source and
            selection["directory"] == record["directory"],
            "SEMANTIC_RUNTIME_TRANSFER_ORIGINAL_SELECTION_CHANGED")
    lock_raw = regular(root / "records/requirements.lock", 1048576)
    wheels = read_json(root / "records/wheel-selection.json")
    require(wheels.get("schema") == "stellar-forge.dcat-semantic-wheel-selection.v1" and
            wheels.get("requirementsSha256") == source["requirementsSha256"] and
            wheels.get("lockSha256") == manifest["lockSha256"] == record["lockSha256"] == sha(lock_raw) and
            wheels.get("packages") == manifest["packages"],
            "SEMANTIC_RUNTIME_TRANSFER_LOCK_CHANGED")
    runtime.verify_inventory(root / "wheels", wheels["inventory"])
    seen, filenames = set(), set()
    require(isinstance(wheels["packages"], list) and 0 < len(wheels["packages"]) <= 4096,
            "SEMANTIC_RUNTIME_TRANSFER_PACKAGE_LIMIT")
    for row in wheels["packages"]:
        filename = member(row["file"])
        require("/" not in filename and filename.endswith(".whl") and filename not in filenames,
                "SEMANTIC_RUNTIME_TRANSFER_WHEEL_INVALID")
        name, version = wheel_metadata(root / "wheels" / filename)
        require(name not in seen and row["name"] == name and row["version"] == version,
                "SEMANTIC_RUNTIME_TRANSFER_WHEEL_INVALID")
        seen.add(name)
        filenames.add(filename)
        identity = runtime.file_identity(root / "wheels" / filename)
        require(all(identity[key] == row[key] for key in ("bytes", "sha256")),
                "SEMANTIC_RUNTIME_TRANSFER_WHEEL_CHANGED")
    require(filenames == {row["path"] for row in wheels["inventory"]} and
            all(any(row["name"] == name and row["version"] == version for row in wheels["packages"])
                for name, version in runtime.PINNED.items()), "SEMANTIC_RUNTIME_TRANSFER_COMPLETE_WHEELS_REQUIRED")
    canonical_lock = ("# Complete original dependency resolution; every selected wheel is retained.\n" +
                      "".join(row["name"] + "==" + row["version"] + " --hash=sha256:" + row["sha256"] + "\n"
                              for row in sorted(wheels["packages"], key=lambda value: value["name"]))).encode("utf-8")
    require(lock_raw == canonical_lock, "SEMANTIC_RUNTIME_TRANSFER_LOCK_CHANGED")
    require(manifest["sender"] == {"directory": record["directory"], "python": record["python"],
                                  "createdAt": record["createdAt"]},
            "SEMANTIC_RUNTIME_TRANSFER_SENDER_CHANGED")
    return source, wheels

@contextmanager
def bundle(file, expected_sha256=None):
    file = Path(file)
    require(file.is_absolute(), "SEMANTIC_RUNTIME_TRANSFER_ABSOLUTE_PATH_REQUIRED")
    handle = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    stream = os.fdopen(handle, "rb")
    try:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_size <= MAX_ARCHIVE, "SEMANTIC_RUNTIME_TRANSFER_FILE_INVALID")
        digest, count = hashlib.sha256(), 0
        for raw in chunks(stream):
            count += len(raw)
            require(count <= before.st_size and count <= MAX_ARCHIVE,
                    "SEMANTIC_RUNTIME_TRANSFER_FILE_CHANGED")
            digest.update(raw)
        require(count == before.st_size, "SEMANTIC_RUNTIME_TRANSFER_FILE_CHANGED")
        identity = {"bytes": count, "sha256": digest.hexdigest()}
        require(expected_sha256 is None or expected_sha256 == identity["sha256"],
                "SEMANTIC_RUNTIME_TRANSFER_HASH_CHANGED")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            require(0 < len(entries) <= MAX_MEMBERS + 1 and len({row.filename for row in entries}) == len(entries),
                    "SEMANTIC_RUNTIME_TRANSFER_ZIP_INVENTORY_INVALID")
            for entry in entries:
                member(entry.filename)
                require(not entry.is_dir() and not entry.flag_bits & 1 and
                        entry.compress_type == zipfile.ZIP_STORED and
                        stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG) and
                        0 <= entry.file_size <= runtime.MAX_FILE,
                        "SEMANTIC_RUNTIME_TRANSFER_ZIP_MEMBER_INVALID")
            index = archive.getinfo("transfer-manifest.json")
            require(index.file_size <= 16777216, "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_TOO_LARGE")
            manifest_raw = archive.read(index)
            manifest = json.loads(manifest_raw)
            require(manifest.get("schema") == MANIFEST and isinstance(manifest.get("files"), list),
                    "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_INVALID")
            expected = {}
            for row in manifest["files"]:
                name = member(row["path"])
                require(name not in expected and name.startswith(("source/", "wheels/", "records/")) and
                        isinstance(row.get("bytes"), int) and not isinstance(row["bytes"], bool) and
                        0 <= row["bytes"] <= runtime.MAX_FILE and
                        isinstance(row.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]),
                        "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_INVALID")
                expected[name] = row
            require(len(expected) <= MAX_MEMBERS and
                    set(expected) | {"transfer-manifest.json"} == {row.filename for row in entries} and
                    sum(row["bytes"] for row in expected.values()) <= runtime.MAX_TOTAL,
                    "SEMANTIC_RUNTIME_TRANSFER_ZIP_INVENTORY_INVALID")
            for name, row in expected.items():
                require(archive.getinfo(name).file_size == row["bytes"],
                        "SEMANTIC_RUNTIME_TRANSFER_ZIP_SIZE_CHANGED")
                with archive.open(name) as source:
                    digest = hashlib.sha256()
                    total = 0
                    for raw in chunks(source):
                        total += len(raw)
                        require(total <= row["bytes"], "SEMANTIC_RUNTIME_TRANSFER_MEMBER_TOO_LARGE")
                        digest.update(raw)
                    require(total == row["bytes"] and digest.hexdigest() == row["sha256"],
                            "SEMANTIC_RUNTIME_TRANSFER_MEMBER_CHANGED")
            identity["manifestSha256"] = sha(manifest_raw)
            yield archive, manifest, manifest_raw, identity
        after = os.fstat(stream.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "SEMANTIC_RUNTIME_TRANSFER_FILE_CHANGED")
    finally:
        stream.close()

def inspect_bundle(file, expected_sha256):
    require(isinstance(expected_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", expected_sha256),
            "SEMANTIC_RUNTIME_TRANSFER_EXPECTED_HASH_REQUIRED")
    with bundle(file, expected_sha256) as (_, manifest, _, identity):
        result = {"schema": MANIFEST, "file": str(file), **identity, "manifest": manifest,
                  "status": "VERIFIED_BYTES",
                  "qualification": "Complete archive and member identities verified. Original source, wheel metadata and lock semantics are validated during receiving before installation."}
    return result

def export_bundle(directory, out):
    root = runtime.private_directory(directory)
    record = runtime.inspect(root)
    runtime.source_selection(root / "source")
    out = outside_project(out)
    runtime.private_directory(out.parent)
    require(not out.is_relative_to(root), "SEMANTIC_RUNTIME_TRANSFER_OUTPUT_OUTSIDE_RUNTIME_REQUIRED")
    manifest = manifest_for(root, record)
    manifest_raw = encoded(manifest)
    require(len(manifest_raw) <= 16777216, "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_TOO_LARGE")
    if out.exists() or out.is_symlink():
        with bundle(out) as (_, prior, _, identity):
            require(prior == manifest, "SEMANTIC_RUNTIME_TRANSFER_OUTPUT_EXISTS")
        return {"schema": MANIFEST, "file": str(out), **identity, "manifest": manifest, "status": "EXPORTED"}
    temporary = out.parent / (".semantic-transfer-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            def entry(name):
                value = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                value.compress_type = zipfile.ZIP_STORED
                value.create_system = 3
                value.external_attr = (stat.S_IFREG | 0o600) << 16
                return value
            archive.writestr(entry("transfer-manifest.json"), manifest_raw)
            for row in manifest["files"]:
                original = root / (row["path"][8:] if row["path"].startswith("records/") else row["path"])
                with archive.open(entry(row["path"]), "w", force_zip64=True) as target:
                    handle = os.open(original, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(handle, "rb") as source:
                        digest = hashlib.sha256()
                        length = 0
                        for raw in chunks(source):
                            length += len(raw)
                            require(length <= row["bytes"], "SEMANTIC_RUNTIME_TRANSFER_SOURCE_CHANGED")
                            digest.update(raw)
                            target.write(raw)
                        require(length == row["bytes"] and digest.hexdigest() == row["sha256"],
                                "SEMANTIC_RUNTIME_TRANSFER_SOURCE_CHANGED")
        stream.flush()
        os.fsync(stream.fileno())
    with bundle(temporary) as (_, actual_manifest, _, identity):
        require(actual_manifest == manifest, "SEMANTIC_RUNTIME_TRANSFER_SOURCE_CHANGED")
    os.link(temporary, out)
    temporary.unlink()
    runtime.sync_dir(out.parent)
    return {"schema": MANIFEST, "file": str(out), **identity, "manifest": manifest, "status": "EXPORTED"}

def inspect_received(directory, expected_sha256=None):
    root = runtime.private_directory(outside_project(directory))
    raw = regular(root / "received-transfer.json", 16777216)
    require(expected_sha256 is None or sha(raw) == expected_sha256,
            "SEMANTIC_RUNTIME_TRANSFER_RECEIPT_CHANGED")
    receipt = json.loads(raw)
    require(receipt.get("schema") == RECEIVED and receipt.get("status") == "READY_INPUTS" and
            receipt.get("directory") == str(root), "SEMANTIC_RUNTIME_TRANSFER_RECEIPT_INVALID")
    manifest_raw = regular(root / "transfer-manifest.json", 16777216)
    require(sha(manifest_raw) == receipt["bundle"]["manifestSha256"],
            "SEMANTIC_RUNTIME_TRANSFER_MANIFEST_CHANGED")
    manifest = json.loads(manifest_raw)
    source, wheels = validate_payload(root / "payload", manifest)
    selection = read_json(root / "transfer-selection.json")
    require(selection == {"schema": SELECTED, "directory": str(root), "bundle": receipt["bundle"]},
            "SEMANTIC_RUNTIME_TRANSFER_SELECTION_CHANGED")
    require(receipt["source"] == source and receipt["lockSha256"] == wheels["lockSha256"] and
            receipt["sourceRuntimeReceiptSha256"] == manifest["sourceRuntimeReceiptSha256"] and
            receipt["files"] == manifest["files"], "SEMANTIC_RUNTIME_TRANSFER_RECEIPT_CHANGED")
    allowed = {"transfer.lock", "transfer-selection.json", "transfer-manifest.json", "payload", "received-transfer.json"}
    require(all(entry.name in allowed or re.fullmatch(r"\.pending-[a-f0-9]{32}", entry.name)
                for entry in root.iterdir()), "SEMANTIC_RUNTIME_TRANSFER_EXTRA_FILE")
    return {**receipt, "receiptSha256": sha(raw), "receiptBytes": len(raw)}

def receive_bundle(file, expected_sha256, directory):
    root = outside_project(directory)
    if root.exists():
        runtime.private_directory(root)
        require(not list(root.iterdir()) or (root / "transfer-selection.json").exists() or
                {row.name for row in root.iterdir()} <= {"transfer.lock"},
                "SEMANTIC_RUNTIME_TRANSFER_NEW_DIRECTORY_REQUIRED")
    runtime.private_directory(root, True)
    require(not Path(file).is_relative_to(root), "SEMANTIC_RUNTIME_TRANSFER_INPUT_OUTSIDE_RECEIVER_REQUIRED")
    lock = os.open(root / "transfer.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and
                not info.st_mode & 0o077, "SEMANTIC_RUNTIME_TRANSFER_LOCK_INVALID")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(isinstance(expected_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", expected_sha256),
                "SEMANTIC_RUNTIME_TRANSFER_EXPECTED_HASH_REQUIRED")
        with bundle(file, expected_sha256) as (archive, manifest, manifest_raw, identity):
            selection = {"schema": SELECTED, "directory": str(root), "bundle": identity}
            write_bytes(root, "transfer-selection.json", encoded(selection))
            if (root / "received-transfer.json").exists():
                result = inspect_received(root)
                require(result["bundle"] == identity, "SEMANTIC_RUNTIME_TRANSFER_SELECTION_CHANGED")
                return result
            write_bytes(root, "transfer-manifest.json", manifest_raw)
            payload = runtime.private_directory(root / "payload", True)
            for row in manifest["files"]:
                with archive.open(row["path"]) as source:
                    write_owned(payload, row["path"], chunks(source), row)
            source, wheels = validate_payload(payload, manifest)
            receipt = {"schema": RECEIVED, "status": "READY_INPUTS", "directory": str(root),
                       "receivedAt": runtime.now(), "bundle": identity, "source": source,
                       "sourceRuntimeReceiptSha256": manifest["sourceRuntimeReceiptSha256"],
                       "lockSha256": wheels["lockSha256"], "files": manifest["files"],
                       "qualification": "Original source and complete exact wheel lock received. A recipient environment is not prepared until the original offline installation and import checks complete."}
            runtime.atomic(root / "received-transfer.json", receipt)
        return inspect_received(root)
    finally:
        os.close(lock)

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Receive exact original semantic source and wheels without relocating an environment.")
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export")
    export.add_argument("--directory", required=True)
    export.add_argument("--out", required=True)
    check = sub.add_parser("inspect")
    check.add_argument("--file", required=True)
    check.add_argument("--sha256", required=True)
    receive = sub.add_parser("receive")
    receive.add_argument("--file", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--directory", required=True)
    inputs = sub.add_parser("inspect-inputs")
    inputs.add_argument("--directory", required=True)
    inputs.add_argument("--sha256")
    args = parser.parse_args()
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt("Original transfer owner stopped")
    signal.signal(signal.SIGTERM, interrupted)
    runtime.parent_lifecycle()
    try:
        require(sys.platform == "linux" and sys.version_info >= (3, 11),
                "SEMANTIC_RUNTIME_TRANSFER_PYTHON_REQUIRED")
        if args.command == "export":
            result = export_bundle(args.directory, args.out)
        elif args.command == "inspect":
            result = inspect_bundle(args.file, args.sha256)
        elif args.command == "receive":
            result = receive_bundle(args.file, args.sha256, args.directory)
        else:
            result = inspect_received(args.directory, args.sha256)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except BaseException as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__), "message": str(error)[:4000]}),
              file=sys.stderr, flush=True)
        return 130 if isinstance(error, KeyboardInterrupt) else 1

if __name__ == "__main__":
    raise SystemExit(main())
