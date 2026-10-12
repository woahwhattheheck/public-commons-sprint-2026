#!/usr/bin/env python3
"""MIT. Streaming portable source packets; original native publishers stay host-owned."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import uuid
import zipfile
from datetime import datetime, timezone

SCHEMA = "stellar-forge.webdav-source-packet.v1"
STATE_SCHEMA = "stellar-forge.webdav-workspace.v1"
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILES = 8000
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
HASH = r"[a-f0-9]{64}"
PATTERNS = [re.compile(value + r"\Z") for value in [
    r"workspace\.json",
    rf"sources/{UUID}\.json",
    rf"mappings/{UUID}\.json",
    rf"merchants/{UUID}\.json",
    rf"cache/{HASH}/listings/{UUID}\.(xml|json)",
    rf"cache/{HASH}/captures/{UUID}/(intent\.json|progress\.json|transfer\.json|receipt\.json|body\.bin|body\.part|uncheckpointed-{UUID}\.bin)",
    rf"editions/{UUID}/(intent\.json|schema\.csv|dataset\.csv|dataset\.json|source\.json|edition\.json)",
    rf"exports/{UUID}/(dataset\.csv|dataset\.json|source\.json|seller\.json|manifest\.json)",
    rf"exports/{UUID}/webdav/(source\.json|mapping\.json|merchant\.json)",
    rf"exports/{UUID}/webdav/capture/(intent\.json|progress\.json|transfer\.json|receipt\.json|body\.bin|uncheckpointed-{UUID}\.bin)",
    rf"exports/{UUID}/webdav/edition/(intent\.json|schema\.csv|dataset\.csv|dataset\.json|source\.json|edition\.json)",
    rf"exports/{UUID}/webdav/listings/{UUID}\.(xml|json)",
]]
def fault(code, message):
    raise ValueError(code + ": " + message)
def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()
def safe_name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        fault("WEBDAV_PACKET_PATH", "The packet contains an invalid path.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(part in ("", ".", "..") for part in value.split("/")):
        fault("WEBDAV_PACKET_PATH", "The packet contains an invalid path.")
    if not any(pattern.fullmatch(value) for pattern in PATTERNS):
        fault("WEBDAV_PACKET_SCOPE", "The packet contains files outside the original source-workspace scope.")
    return value
def canonical(value):
    path = Path(value)
    if not path.is_absolute() or str(path) != value or path == Path("/") or path.resolve() != path:
        fault("WEBDAV_PACKET_DIRECTORY", "Use a normalized canonical absolute path.")
    return path
def private_directory(path):
    value = path.stat()
    if not stat.S_ISDIR(value.st_mode) or value.st_mode & 0o077 or path.resolve() != path:
        fault("WEBDAV_PACKET_DIRECTORY", "Use a private canonical directory.")
def signature(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode, value.st_nlink)
def regular(path, private=False):
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    value = os.fstat(handle)
    if not stat.S_ISREG(value.st_mode) or private and (value.st_nlink != 1 or value.st_mode & 0o077):
        os.close(handle)
        fault("WEBDAV_PACKET_FILE", "Use unlinked, regular original files with the required private mode.")
    return os.fdopen(handle, "rb"), value
def hash_file(path, maximum=MAX_TOTAL + 16 * 1024 * 1024, private=False):
    handle, before = regular(path, private)
    count, sha = 0, hashlib.sha256()
    with handle:
        if before.st_size > maximum:
            fault("WEBDAV_PACKET_LIMIT", "The file exceeds the supported limit.")
        while True:
            part = handle.read(1024 * 1024)
            if not part:
                break
            sha.update(part); count += len(part)
        if signature(before) != signature(os.fstat(handle.fileno())) or count != before.st_size:
            fault("WEBDAV_PACKET_CHANGED", "The retained file changed while it was read.")
    return {"bytes": count, "sha256": sha.hexdigest()}, before
def synced(path):
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(handle)
    finally:
        os.close(handle)
def write_new(path, content):
    with open(path, "xb") as output:
        os.chmod(path, 0o600); output.write(content); output.flush(); os.fsync(output.fileno())
def zip_info(name):
    value = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    value.create_system = 3
    value.external_attr = (stat.S_IFREG | 0o600) << 16
    value.compress_type = zipfile.ZIP_DEFLATED
    return value
def source_projection(value):
    if not isinstance(value, dict) or value.get("schema") != STATE_SCHEMA or not re.fullmatch(UUID, value.get("id", "")):
        fault("WEBDAV_PACKET_STATE", "The original workspace state is invalid.")
    if not isinstance(value.get("revision"), int) or isinstance(value["revision"], bool) or value["revision"] < 0:
        fault("WEBDAV_PACKET_STATE", "The original workspace revision is invalid.")
    if any(not isinstance(value.get(key), list) for key in ("sources", "mappings", "editions", "exports", "merchants", "products", "operations")):
        fault("WEBDAV_PACKET_STATE", "The original workspace collections are invalid.")
    result = dict(value)
    result["operations"] = []
    result["activeProductId"] = None
    result["handoff"] = {
        "kind": "portable_source_packet",
        "publisherStateIncluded": False,
        "originalWorkspaceId": value["id"],
        "originalRevision": value["revision"],
        "instruction": "Prepare a retained merchant export with the original publisher at the destination host. Existing seller, release, buyer, key and ledger directories remain with their original host backup.",
    }
    return result
def selected_files(root):
    result = []
    for prefix in ("sources", "cache", "mappings", "editions", "merchants", "exports"):
        folder = root / prefix
        if not folder.exists():
            continue
        private_directory(folder)
        for directory, directories, names in os.walk(folder, followlinks=False):
            directories.sort(); names.sort()
            for name in directories:
                child = Path(directory) / name
                if child.is_symlink():
                    fault("WEBDAV_PACKET_SYMLINK", "Source directories must remain canonical.")
                private_directory(child)
            for name in names:
                path = Path(directory) / name
                relative = path.relative_to(root).as_posix()
                # Native leases and atomic-write temporary files are not data.
                if name == "publisher.lock" or name.startswith("."):
                    continue
                safe_name(relative)
                if path.is_symlink():
                    fault("WEBDAV_PACKET_SYMLINK", "Source files must remain canonical.")
                result.append((relative, path))
                if len(result) >= MAX_FILES:
                    fault("WEBDAV_PACKET_LIMIT", "The source packet exceeds its file limit.")
    return sorted(result)
def pack(root, output, request):
    private_directory(root); private_directory(output.parent)
    if output.exists() or output.is_symlink():
        fault("WEBDAV_PACKET_EXISTS", "Choose a new output file; the original is retained.")
    original, before = hash_file(root / "workspace.json", 16 * 1024 * 1024, True)
    if original["sha256"] != request.get("expectedWorkspaceSha256"):
        fault("WEBDAV_PACKET_REVISION", "The source workspace changed before export.")
    with open(root / "workspace.json", "rb") as handle:
        actual = json.load(handle)
    projected = source_projection(actual)
    if request.get("workspaceId") != actual["id"] or request.get("revision") != actual["revision"]:
        fault("WEBDAV_PACKET_REVISION", "The source workspace changed before export.")
    workspace_bytes = encoded(projected)
    pending = output.with_name(output.name + ".partial-" + str(uuid.uuid4()))
    manifest = {"schema": SCHEMA, "createdAt": stamp(),
                "workspace": {"id": actual["id"], "revision": actual["revision"], "createdAt": actual["createdAt"]},
                "publisherStateIncluded": False, "files": []}
    total = 0
    with open(pending, "xb") as target:
        os.chmod(pending, 0o600)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=False) as packet:
            packet.writestr(zip_info("workspace.json"), workspace_bytes)
            manifest["files"].append({"path": "workspace.json", "bytes": len(workspace_bytes), "sha256": digest_bytes(workspace_bytes)})
            total += len(workspace_bytes)
            for name, path in selected_files(root):
                handle, original_stat = regular(path, True)
                sha, count = hashlib.sha256(), 0
                with handle:
                    if original_stat.st_size > MAX_FILE or total + original_stat.st_size > MAX_TOTAL:
                        fault("WEBDAV_PACKET_LIMIT", "The source packet exceeds its byte limit.")
                    with packet.open(zip_info(name), "w") as member:
                        while True:
                            part = handle.read(1024 * 1024)
                            if not part:
                                break
                            member.write(part); sha.update(part); count += len(part)
                    if signature(original_stat) != signature(os.fstat(handle.fileno())) or count != original_stat.st_size:
                        fault("WEBDAV_PACKET_CHANGED", "A source changed during export; retain this partial and retry after review.")
                total += count
                manifest["files"].append({"path": name, "bytes": count, "sha256": sha.hexdigest()})
            if signature(before) != signature((root / "workspace.json").stat()):
                fault("WEBDAV_PACKET_REVISION", "The original workspace changed during export.")
            manifest["bytes"] = total
            packet.writestr(zip_info("manifest.json"), encoded(manifest))
        target.flush(); os.fsync(target.fileno())
    os.link(pending, output)
    pending.unlink(); synced(output.parent)
    result, _ = hash_file(output)
    return {"schema": SCHEMA, "path": str(output), **result, "files": len(manifest["files"]),
            "expandedBytes": total, "workspace": manifest["workspace"], "publisherStateIncluded": False}
def open_packet(path):
    observed, before = hash_file(path)
    handle, initial = regular(path)
    if signature(before) != signature(initial):
        handle.close(); fault("WEBDAV_PACKET_CHANGED", "The source packet changed before inspection.")
    packet = zipfile.ZipFile(handle, "r")
    try:
        members = packet.infolist()
        if len(members) > MAX_FILES + 1 or len({row.filename for row in members}) != len(members):
            fault("WEBDAV_PACKET_MEMBERS", "The packet has too many or duplicate members.")
        metadata = packet.getinfo("manifest.json")
        if metadata.file_size > 8 * 1024 * 1024:
            fault("WEBDAV_PACKET_MANIFEST", "The packet manifest is too large.")
        manifest = json.loads(packet.read(metadata).decode("utf-8"))
        if manifest.get("schema") != SCHEMA or manifest.get("publisherStateIncluded") is not False or not isinstance(manifest.get("files"), list):
            fault("WEBDAV_PACKET_MANIFEST", "Select an original portable source packet.")
        declared, total = {}, 0
        for row in manifest["files"]:
            if not isinstance(row, dict):
                fault("WEBDAV_PACKET_MANIFEST", "A file declaration is invalid.")
            name = safe_name(row.get("path"))
            count, sha = row.get("bytes"), row.get("sha256")
            if name in declared or not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= MAX_FILE or not isinstance(sha, str) or not re.fullmatch(HASH, sha):
                fault("WEBDAV_PACKET_MANIFEST", "A file declaration is invalid or duplicated.")
            total += count; declared[name] = row
        if total > MAX_TOTAL or total != manifest.get("bytes") or set(declared) != {row.filename for row in members} - {"manifest.json"} or "workspace.json" not in declared:
            fault("WEBDAV_PACKET_MEMBERS", "The declared original file set does not match the archive.")
        for info in members:
            mode = info.external_attr >> 16
            if info.is_dir() or mode and not stat.S_ISREG(mode) or info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                fault("WEBDAV_PACKET_MEMBER_TYPE", "Only ordinary unencrypted source files are supported.")
            if info.filename != "manifest.json" and info.file_size != declared[info.filename]["bytes"]:
                fault("WEBDAV_PACKET_MEMBERS", "A member size differs from its declaration.")
        return packet, handle, before, observed, manifest
    except BaseException:
        packet.close(); handle.close(); raise
def unpack(path, destination=None):
    packet, handle, before, observed, manifest = open_packet(path)
    state_bytes = None
    try:
        if destination is not None:
            private_directory(destination.parent)
            destination.mkdir(mode=0o700)  # Native create-only destination, including failed prior attempts.
            write_new(destination / "source-packet-import-incomplete.json", encoded({
                "schema": SCHEMA, "source": observed, "startedAt": stamp(), "status": "IMPORTING"}))
        for row in manifest["files"]:
            sha, count = hashlib.sha256(), 0
            output = None; chunks = []
            if destination is not None and row["path"] != "workspace.json":
                target = destination / row["path"]
                target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                output = open(target, "xb"); os.chmod(target, 0o600)
            try:
                with packet.open(row["path"]) as member:
                    while True:
                        part = member.read(1024 * 1024)
                        if not part:
                            break
                        count += len(part)
                        if count > row["bytes"]:
                            fault("WEBDAV_PACKET_BYTES", "A member expanded beyond its declared length.")
                        sha.update(part)
                        if row["path"] == "workspace.json":
                            if count > 16 * 1024 * 1024:
                                fault("WEBDAV_PACKET_STATE", "The workspace state is too large.")
                            chunks.append(part)
                        elif output is not None:
                            output.write(part)
                if count != row["bytes"] or sha.hexdigest() != row["sha256"]:
                    fault("WEBDAV_PACKET_BYTES", "A retained source member differs from its original hash.")
                if row["path"] == "workspace.json":
                    state_bytes = b"".join(chunks)
                if output is not None:
                    output.flush(); os.fsync(output.fileno())
            finally:
                if output is not None:
                    output.close()
        if signature(before) != signature(os.fstat(handle.fileno())):
            fault("WEBDAV_PACKET_CHANGED", "The packet changed during inspection.")
        original = json.loads(state_bytes.decode("utf-8"))
        value = source_projection(original)
        if original.get("operations") or original.get("activeProductId") is not None or original.get("handoff", {}).get("publisherStateIncluded") is not False:
            fault("WEBDAV_PACKET_STATE", "The packet must contain a portable source projection.")
        if original["id"] != manifest["workspace"]["id"] or original["revision"] != manifest["workspace"]["revision"]:
            fault("WEBDAV_PACKET_STATE", "The original workspace identity differs from the manifest.")
        result = {"schema": SCHEMA, "source": observed, "files": len(manifest["files"]),
                  "expandedBytes": manifest["bytes"], "originalWorkspace": manifest["workspace"], "publisherStateIncluded": False}
        if destination is not None:
            value["id"] = str(uuid.uuid4()); value["revision"] = 0
            value["createdAt"] = stamp(); value["updatedAt"] = value["createdAt"]
            value["sourcePacket"] = {"sha256": observed["sha256"], "bytes": observed["bytes"],
                                     "originalWorkspace": manifest["workspace"], "importedAt": value["createdAt"]}
            write_new(destination / "imported-workspace.json", state_bytes)
            write_new(destination / "source-packet-import.json", encoded({**result, "completedAt": stamp(), "workspaceId": value["id"]}))
            write_new(destination / "workspace.json", encoded(value))
            (destination / "source-packet-import-incomplete.json").unlink()
            for directory, _, _ in os.walk(destination, topdown=False):
                synced(directory)
            synced(destination.parent)
            result.update({"directory": str(destination), "workspaceId": value["id"], "revision": 0})
        else:
            result["manifest"] = manifest
            result["counts"] = {key: len(original[key]) for key in ("sources", "mappings", "editions", "exports", "merchants", "products")}
        return result
    finally:
        packet.close(); handle.close()
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("pack"); make.add_argument("--root", required=True); make.add_argument("--out", required=True)
    inspect = sub.add_parser("inspect"); inspect.add_argument("--input", required=True)
    restore = sub.add_parser("restore"); restore.add_argument("--input", required=True); restore.add_argument("--directory", required=True)
    args = parser.parse_args()
    if args.command == "pack":
        request = json.loads(sys.stdin.buffer.read(1024 * 1024))
        result = pack(canonical(args.root), canonical(args.out), request)
    else:
        result = unpack(canonical(args.input), canonical(args.directory) if args.command == "restore" else None)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error)
        if isinstance(error, ValueError) and message.startswith("WEBDAV_"):
            code, _, message = message.partition(": ")
        else:
            code, message = "WEBDAV_PACKET_FAILED", "The native source packet operation did not complete; the original files and any new partial destination are retained."
        print(json.dumps({"error": {"code": code, "message": message}}))
        sys.exit(2)
