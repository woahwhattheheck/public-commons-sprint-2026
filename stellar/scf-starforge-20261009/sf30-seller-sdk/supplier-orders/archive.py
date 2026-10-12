#!/usr/bin/env python3
"""MIT. Complete streaming supplier-order ZIP64 pack/unpack; Python standard library."""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path

SCHEMA = "stellar-forge.supplier-orders-package.v1"
PROFILE = "unite-opentrans-1.0"
MAX_BYTES = 8 * 1024 * 1024 * 1024
MAX_MANIFEST = 32 * 1024 * 1024
MAX_ENTRIES = 100002
CHUNK = 1024 * 1024
FILE_NAME = re.compile(r"files/[a-f0-9]{64}\.bin\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")

class PackageError(Exception):
    pass

def require(condition, message):
    if not condition:
        raise PackageError(message)

def regular(path):
    value = os.lstat(path)
    require(stat.S_ISREG(value.st_mode) and not stat.S_ISLNK(value.st_mode), "Use a complete regular source file.")
    return value

def load_json(path, maximum):
    info = regular(path)
    require(info.st_size <= maximum, "The complete descriptor exceeds its supported size.")
    with open(path, "rb") as stream:
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, "The complete descriptor exceeds its supported size.")
    return json.loads(value)

def path_allowed(name):
    return name == "workspace.jsonl" or bool(FILE_NAME.fullmatch(name))

def manifest_valid(manifest):
    require(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA, "Unsupported supplier-order package schema.")
    require(manifest.get("profileId") == PROFILE, "The package uses a different original document profile.")
    require(isinstance(manifest.get("workspaceId"), str) and 0 < len(manifest["workspaceId"]) <= 200, "Missing original workspace identity.")
    entries = manifest.get("entries")
    require(isinstance(entries, list) and 1 <= len(entries) < MAX_ENTRIES, "Missing or excessive complete package entries.")
    names, total = set(), 0
    for entry in entries:
        require(isinstance(entry, dict), "Invalid package entry.")
        name, size, sha = entry.get("path"), entry.get("bytes"), entry.get("sha256")
        require(isinstance(name, str) and path_allowed(name) and name not in names, "Duplicate or unsupported package path.")
        require(type(size) is int and 0 <= size <= MAX_BYTES, "Invalid complete entry size.")
        require(isinstance(sha, str) and SHA.fullmatch(sha), "Missing original entry SHA-256.")
        if name.startswith("files/"):
            require(name == "files/" + sha + ".bin", "The file name differs from its content identity.")
        names.add(name)
        total += size
    require("workspace.jsonl" in names and total <= MAX_BYTES, "The complete package exceeds 8 GiB or lacks workspace data.")
    require(manifest.get("totalBytes") == total, "The manifest total differs from its complete entries.")
    return entries

def secure_read(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    require(stat.S_ISREG(os.fstat(descriptor).st_mode), "Source file changed before reading.")
    return os.fdopen(descriptor, "rb")

def stream_member(source, target, expected):
    sha, size = hashlib.sha256(), 0
    while True:
        chunk = source.read(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        require(size <= expected["bytes"], "The original member exceeds its declared complete length.")
        sha.update(chunk)
        target.write(chunk)
    require(size == expected["bytes"] and sha.hexdigest() == expected["sha256"], "The original member length or SHA-256 differs.")
    return size

def pack(descriptor_path, output):
    descriptor = load_json(descriptor_path, MAX_MANIFEST)
    manifest, sources = descriptor.get("manifest"), descriptor.get("sources")
    entries = manifest_valid(manifest)
    require(isinstance(sources, dict) and set(sources) == {entry["path"] for entry in entries}, "Source paths do not match the complete manifest.")
    payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    require(len(payload) <= MAX_MANIFEST, "The full manifest exceeds 32 MiB.")
    result, created = None, False
    try:
        with open(output, "xb") as target:
            created = True
            os.chmod(output, 0o600)
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                archive.writestr("package.json", payload)
                for entry in entries:
                    source_path = sources[entry["path"]]
                    info = regular(source_path)
                    require(info.st_size == entry["bytes"], "A complete source file changed before packaging.")
                    member = zipfile.ZipInfo(entry["path"])
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.external_attr = (stat.S_IFREG | 0o600) << 16
                    member.file_size = info.st_size
                    with secure_read(source_path) as source, archive.open(member, "w", force_zip64=True) as destination:
                        stream_member(source, destination, entry)
            target.flush()
            os.fsync(target.fileno())
        sha, size = hashlib.sha256(), 0
        with secure_read(output) as stream:
            for chunk in iter(lambda: stream.read(CHUNK), b""):
                sha.update(chunk)
                size += len(chunk)
        require(size <= MAX_BYTES, "The complete ZIP exceeds the 8 GiB transfer limit.")
        result = {"schema": SCHEMA, "workspaceId": manifest["workspaceId"], "bytes": size, "sha256": sha.hexdigest(), "entries": len(entries) + 1, "totalBytes": manifest["totalBytes"], "tableCounts": manifest.get("tableCounts", {})}
    except Exception:
        if result is None and created:
            try:
                os.unlink(output)
            except FileNotFoundError:
                pass
        raise
    return result

def unpack(source_path, destination):
    info = regular(source_path)
    require(0 < info.st_size <= MAX_BYTES, "Select a complete package of up to 8 GiB.")
    target_root = Path(destination)
    root_info = os.lstat(target_root)
    require(stat.S_ISDIR(root_info.st_mode) and not stat.S_ISLNK(root_info.st_mode), "Use the original private receiving directory.")
    require(not any(target_root.iterdir()), "Receive the complete package into an empty private directory.")
    with secure_read(source_path) as source, zipfile.ZipFile(source, "r", allowZip64=True) as archive:
        listed = archive.infolist()
        require(1 < len(listed) <= MAX_ENTRIES, "Invalid complete package member count.")
        names = [item.filename for item in listed]
        require(len(set(names)) == len(names) and names.count("package.json") == 1, "Duplicate package members.")
        index = next(item for item in listed if item.filename == "package.json")
        require(index.file_size <= MAX_MANIFEST, "The full manifest exceeds 32 MiB.")
        manifest = json.loads(archive.read(index))
        entries = manifest_valid(manifest)
        expected = {entry["path"]: entry for entry in entries}
        require(set(names) == set(expected) | {"package.json"}, "The complete ZIP and manifest have different members.")
        for member in listed:
            require(not member.flag_bits & 1 and not member.is_dir(), "Encrypted or directory entries are unsupported.")
            mode = member.external_attr >> 16
            require(not stat.S_ISLNK(mode), "Symbolic link entries are unsupported.")
            require(member.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "Unsupported member compression.")
        (target_root / "files").mkdir(mode=0o700)
        manifest_path = target_root / "package.json"
        with open(manifest_path, "xb") as output:
            os.chmod(manifest_path, 0o600)
            output.write(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        for member in listed:
            if member.filename == "package.json":
                continue
            entry = expected[member.filename]
            require(member.file_size == entry["bytes"], "The complete member size differs from the manifest.")
            path = target_root / member.filename
            with archive.open(member, "r") as original, open(path, "xb") as received:
                os.chmod(path, 0o600)
                stream_member(original, received, entry)
                received.flush()
                os.fsync(received.fileno())
    return {"manifest": manifest, "directory": str(target_root)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("pack", "unpack"))
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    try:
        result = pack(args.source, args.destination) if args.mode == "pack" else unpack(args.source, args.destination)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"error": {"code": "ORDER_PACKAGE_INVALID", "message": str(error)}}), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
