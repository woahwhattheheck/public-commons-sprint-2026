#!/usr/bin/env python3
"""Verify and receive the complete Upper Savannah application source carrier.

Source-map members use their declared UTF-8 or base64 encoding. Byte counts,
SHA-256 and optional Git blob identities always describe the decoded file.
"""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile

MAX_BYTES = 16 * 1024 * 1024
PART_SCHEMA = "upstate.application-source-part/v1"

def digest(data):
    return hashlib.sha256(data).hexdigest()

def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result

def decode_json(data):
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique_pairs)

def uncompress(data):
    if data[:2] != b"\x1f\x8b":
        return data
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as source:
        decoded = source.read(MAX_BYTES + 1)
    if len(decoded) > MAX_BYTES:
        raise ValueError("Source carrier exceeds its declared receiving limit")
    return decoded

def read_carrier(path):
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError("Source carrier exceeds the receiving limit")
    if data[:2] == b"\x1f\x8b" or data.lstrip().startswith(b"{"):
        decoded = uncompress(data)
    else:
        parts = []
        for block in re.findall(r"\x60\x60\x60json\s*\n(.*?)\n\x60\x60\x60", data.decode("utf-8"), re.S):
            item = json.loads(block, object_pairs_hook=unique_pairs)
            if item.get("schema") == PART_SCHEMA:
                parts.append(item)
        if not parts:
            raise ValueError("No complete application source parts found")
        parts.sort(key=lambda item: item["part"])
        first = parts[0]
        if len(parts) != first["parts"] or [p["part"] for p in parts] != list(range(1, len(parts) + 1)):
            raise ValueError("Missing or duplicate source part")
        fields = ("parts", "payload_sha256", "payload_bytes", "compressed_sha256", "compressed_bytes", "encoding")
        if any(any(p.get(k) != first.get(k) for k in fields) for p in parts):
            raise ValueError("Source parts belong to different carriers")
        if first["encoding"] != "gzip+base64":
            raise ValueError("Unsupported source-part encoding")
        compressed = base64.b64decode("".join(p["data"] for p in parts), validate=True)
        if len(compressed) != first["compressed_bytes"] or digest(compressed) != first["compressed_sha256"]:
            raise ValueError("Compressed carrier identity mismatch")
        decoded = uncompress(compressed)
        if len(decoded) != first["payload_bytes"] or digest(decoded) != first["payload_sha256"]:
            raise ValueError("Source carrier identity mismatch")
    value = decode_json(decoded)
    if value.get("schema") != "commons.source-map/1" or value.get("kind") != "upstate.complete-application-source/v1":
        raise ValueError("This is not the selected complete application carrier")
    source_files, metadata = value.get("files"), value.get("file_metadata")
    if not isinstance(source_files, dict) or not isinstance(metadata, dict) or not source_files or len(source_files) > 1000:
        raise ValueError("Invalid complete application file map")
    if set(source_files) != set(metadata):
        raise ValueError("Source file and metadata inventories differ")
    verified = {}
    for name, content in source_files.items():
        p = PurePosixPath(name)
        if not isinstance(content, str) or not name or p.is_absolute() or str(p) != name or "\\" in name or "\0" in name or any(x in (".", "..") for x in p.parts):
            raise ValueError("Invalid source member path")
        entry = metadata[name]
        if not isinstance(entry, dict):
            raise ValueError("Invalid source member metadata: " + name)
        encoding = entry.get("encoding", "utf-8")
        if encoding in ("utf-8", "utf8"):
            body = content.encode("utf-8")
        elif encoding == "base64":
            body = base64.b64decode(content, validate=True)
        else:
            raise ValueError("Unsupported source member encoding: " + name)
        if entry.get("bytes") != len(body) or entry.get("sha256") != digest(body):
            raise ValueError("Source body mismatch: " + name)
        expected_git = entry.get("git_blob")
        if expected_git:
            actual = hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
            if actual != expected_git:
                raise ValueError("Original Git body mismatch: " + name)
        if entry.get("mode") not in ("100644", "100755"):
            raise ValueError("Unsupported source member mode")
        verified[name] = body
    receipt = {"schema": "upstate.application-source-receipt/v1",
               "source_ref": value["source_ref"], "repository": value["repository"],
               "payload_sha256": digest(decoded), "payload_bytes": len(decoded),
               "files": len(verified), "source_bytes": sum(map(len, verified.values())),
               "state": "application_source_received", "scientific_execution": "not_performed"}
    return value, verified, receipt

def verify_directory(target, files, receipt):
    marker = target / "APPLICATION_SOURCE_RECEIPT.json"
    if target.is_symlink() or not target.is_dir() or not marker.is_file() or marker.is_symlink():
        raise ValueError("Destination is not this retained application receiver")
    saved = json.loads(marker.read_text("utf-8"))
    if saved != receipt:
        raise ValueError("Destination belongs to a different application carrier")
    for name, expected in files.items():
        path = target.joinpath(*PurePosixPath(name).parts)
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes() != expected:
            raise ValueError("Received source changed: " + name)
        if any(parent.is_symlink() for parent in path.parents if parent != target.parent):
            raise ValueError("Received source has a directory alias")
    return marker

def receive(target, files, metadata, receipt):
    if target.exists() or target.is_symlink():
        verify_directory(target, files, receipt)
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".upstate-source-", dir=target.parent))
    try:
        for name, body in sorted(files.items()):
            path = temporary.joinpath(*PurePosixPath(name).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as output:
                output.write(body)
                output.flush()
                os.fsync(output.fileno())
            path.chmod(0o755 if metadata[name]["mode"] == "100755" else 0o644)
        (temporary / "APPLICATION_SOURCE_RECEIPT.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        if target.exists() or target.is_symlink():
            raise ValueError("Destination appeared during receiving")
        os.rename(temporary, target)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    verify_directory(target, files, receipt)
    return False

def archive(destination, files, metadata, receipt):
    expected = {"upper-savannah-application/" + name: data for name, data in files.items()}
    expected["upper-savannah-application/APPLICATION_SOURCE_RECEIPT.json"] = (json.dumps(receipt, indent=2) + "\n").encode("utf-8")
    def verify(path):
        with zipfile.ZipFile(path) as reader:
            names = reader.namelist()
            if len(names) != len(set(names)) or set(names) != set(expected):
                raise ValueError("Application ZIP member set differs")
            for name, data in expected.items():
                if reader.read(name) != data:
                    raise ValueError("Application ZIP source mismatch: " + name)
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_file():
            raise ValueError("Application ZIP is not a retained regular file")
        verify(destination)
        return {"path": str(destination), "bytes": destination.stat().st_size, "sha256": digest(destination.read_bytes()), "reused": True}
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, pending_name = tempfile.mkstemp(prefix=".upstate-zip-", dir=destination.parent)
    os.close(fd)
    pending = Path(pending_name)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as writer:
            for name, data in sorted(expected.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
                relative = name.removeprefix("upper-savannah-application/")
                mode = 0o755 if metadata.get(relative, {}).get("mode") == "100755" else 0o644
                info.external_attr = (stat.S_IFREG | mode) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                writer.writestr(info, data)
        verify(pending)
        with pending.open("rb") as source:
            os.fsync(source.fileno())
        os.link(pending, destination)
    finally:
        pending.unlink(missing_ok=True)
    verify(destination)
    return {"path": str(destination), "bytes": destination.stat().st_size, "sha256": digest(destination.read_bytes()), "reused": False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("carrier", type=Path, help="Original JSON, JSON.gz, or saved complete Canvas Markdown")
    parser.add_argument("--output", type=Path, help="Fresh application directory, or the identical original received directory")
    parser.add_argument("--zip", dest="archive_path", type=Path, help="Write the exact application as a portable ZIP")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    value, files, receipt = read_carrier(args.carrier)
    result = dict(receipt)
    if not args.verify_only:
        if args.output is None:
            parser.error("--output is required for receiving")
        target = args.output.absolute()
        result["reused"] = receive(target, files, value["file_metadata"], receipt)
        result["directory"] = str(target)
        if args.archive_path:
            result["archive"] = archive(args.archive_path.absolute(), files, value["file_metadata"], receipt)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
