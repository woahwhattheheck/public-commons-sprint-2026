#!/usr/bin/env python3
"""Receive the complete original Project Portfolio native input selection."""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zipfile

SCHEMA = "project-portfolio-native-inputs.v1"
OPERATION = "PROJECT-PORTFOLIO-NATIVE-B9D2-20261012"
MAX_PACKET_BYTES = 32 * 1024 * 1024
MAX_FILES_BYTES = 32 * 1024 * 1024
HEX256 = re.compile(r"[0-9a-f]{64}\Z")
HEX160 = re.compile(r"[0-9a-f]{40}\Z")


class InputError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise InputError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Repeated JSON object key: " + key)
        result[key] = value
    return result


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def file_identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def member_path(value):
    require(isinstance(value, str) and value and "\\" not in value and ":" not in value
            and "\0" not in value and not any(ord(c) < 32 for c in value),
            "The source member path is not a plain relative filename.")
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value
            and all(part not in ("", ".", "..") for part in path.parts)
            and path.parts[0] in ("source", "upstream") and len(path.parts) > 1,
            "A source member must remain inside source/ or upstream/: " + value)
    return path


def load_packet(path, expected_sha):
    require(isinstance(expected_sha, str) and HEX256.fullmatch(expected_sha),
            "Use the published complete input SHA-256.")
    if path == "-":
        raw = sys.stdin.buffer.read(MAX_PACKET_BYTES + 1)
    else:
        with open(path, "rb") as stream:
            raw = stream.read(MAX_PACKET_BYTES + 1)
    require(len(raw) <= MAX_PACKET_BYTES, "The complete input exceeds the declared 32 MiB selection.")
    require(hashlib.sha256(raw).hexdigest() == expected_sha,
            "The complete input bytes differ from the published selection.")
    packet = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    require(isinstance(packet, dict) and packet.get("schema") == SCHEMA
            and packet.get("operation_id") == OPERATION, "Select this original portfolio operation.")
    files, manifest = packet.get("files"), packet.get("source_manifest")
    require(isinstance(files, dict) and isinstance(manifest, list)
            and 1 <= len(manifest) <= 4096, "The complete source files and manifest are required.")
    names, folded, selected = set(), set(), []
    total = 0
    for record in manifest:
        require(isinstance(record, dict), "A complete source manifest row is required.")
        path = member_path(record.get("path"))
        name = path.as_posix()
        require(name not in names and name.casefold() not in folded,
                "Repeated or case-colliding source member: " + name)
        names.add(name)
        folded.add(name.casefold())
        require(type(record.get("bytes")) is int and 0 <= record["bytes"] <= MAX_FILES_BYTES
                and isinstance(record.get("sha256"), str) and HEX256.fullmatch(record["sha256"]),
                "An exact byte count and SHA-256 are required: " + name)
        entry = files.get(name)
        require(isinstance(entry, dict) and set(entry) == {"content", "encoding"}
                and isinstance(entry["content"], str)
                and entry["encoding"] == record.get("encoding")
                and entry["encoding"] in ("utf-8", "base64"), "The source representation differs: " + name)
        try:
            content = (entry["content"].encode("utf-8") if entry["encoding"] == "utf-8"
                       else base64.b64decode(entry["content"], validate=True))
        except (ValueError, UnicodeError) as exc:
            raise InputError("The source representation cannot be decoded: " + name) from exc
        require(file_identity(content) == {"bytes": record["bytes"], "sha256": record["sha256"]},
                "The original member bytes differ: " + name)
        if "git_blob" in record:
            require(isinstance(record["git_blob"], str) and HEX160.fullmatch(record["git_blob"])
                    and git_blob(content) == record["git_blob"],
                    "The member differs from its original Git blob: " + name)
        total += len(content)
        require(total <= MAX_FILES_BYTES, "The complete selected files exceed 32 MiB.")
        selected.append((path, content, record))
    require(set(files) == names, "The packet contains missing or unselected source members.")
    require(packet.get("files_count") == len(selected) and packet.get("files_bytes") == total,
            "The complete source selection totals differ.")
    required = {
        "source/portfolio/native.py", "source/portfolio/workspace.py",
        "source/native_receiving.py", "source/operator/native/receive.py",
        "source/operator/native/browser.mjs",
        "upstream/junit/data/timephased-budget-baseline.mpp",
        "upstream/junit/data/calendar-exception-precedence-daily.mpp",
        "upstream/junit/data/generated/assignment-assignments/assignment-assignments-project2019-mspdi.xml",
        "upstream/junit/data/baselines.xml", "upstream/junit/data/enterprise.xml",
    }
    require(required <= names, "The source or original five-fixture cohort is incomplete.")
    return packet, selected


def ensure_directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    observed = path.lstat()
    require(stat.S_ISDIR(observed.st_mode) and not stat.S_ISLNK(observed.st_mode),
            "An original receiving directory was replaced: " + str(path))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def original_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "An original source member is not a regular file.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            return stream.read(MAX_FILES_BYTES + 1)
    finally:
        os.close(fd)


def retain_file(path, content):
    if os.path.lexists(path):
        require(original_bytes(path) == content, "An existing source member has different bytes: " + str(path))
        return "reopened"
    descriptor, temporary = tempfile.mkstemp(prefix=".portfolio-input-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        # The operation lock owns this receiving directory. Link also prevents
        # an unexpected existing file from being overwritten.
        os.link(temporary, path, follow_symlinks=False)
        os.unlink(temporary)
        sync_directory(path.parent)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)
    require(original_bytes(path) == content, "The retained source readback differs: " + str(path))
    return "received"


def receive(packet_path, expected_sha, directory, make_zip=False):
    packet, selected = load_packet(packet_path, expected_sha)
    root = Path(directory).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_directory(root)
    inputs = root / "received-inputs"
    ensure_directory(inputs)
    selection = inputs / expected_sha
    ensure_directory(selection)
    fd = os.open(selection / ".receive.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "The original input lock is not a regular file.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        received = reopened = 0
        for relative, content, _ in selected:
            parent = selection
            for part in relative.parts[:-1]:
                parent = parent / part
                ensure_directory(parent)
            outcome = retain_file(parent / relative.name, content)
            received += outcome == "received"
            reopened += outcome == "reopened"
        manifest = {key: value for key, value in packet.items() if key != "files"}
        manifest["input_sha256"] = expected_sha
        retain_file(selection / "NATIVE_INPUTS.json", encode(manifest))
        receipt = {
            "schema": "project-portfolio-input-receipt.v1", "operation_id": OPERATION,
            "input_sha256": expected_sha, "files": len(selected), "bytes": packet["files_bytes"],
            "source": "source", "upstream": "upstream",
            "source_identity": packet["source_identity"], "upstream_identity": packet["upstream_identity"],
        }
        retain_file(selection / "RECEIVED.json", encode(receipt))
        result = {
            **receipt, "state": "INPUTS_RECEIVED", "new_files": received, "reopened_files": reopened,
            "directory": str(selection), "source_directory": str(selection / "source"),
            "upstream_directory": str(selection / "upstream"),
            "manifest": str(selection / "NATIVE_INPUTS.json"), "receipt": str(selection / "RECEIVED.json"),
        }
        if make_zip:
            archive = selection / "Project_Portfolio_Source_and_Native_Inputs.zip"
            if os.path.lexists(archive):
                require(stat.S_ISREG(archive.lstat().st_mode), "The existing input ZIP is not a regular file.")
                with zipfile.ZipFile(archive) as existing:
                    names = [path.as_posix() for path, _, _ in selected] + ["NATIVE_INPUTS.json", "RECEIVED.json"]
                    require(set(existing.namelist()) == set(names)
                            and len(existing.infolist()) == len(names), "The existing input ZIP members differ.")
                    for relative, content, _ in selected:
                        require(existing.read(relative.as_posix()) == content,
                                "The existing input ZIP source differs: " + relative.as_posix())
                    require(existing.read("NATIVE_INPUTS.json") == encode(manifest)
                            and existing.read("RECEIVED.json") == encode(receipt),
                            "The existing input ZIP selection differs.")
            else:
                descriptor, temporary = tempfile.mkstemp(prefix=".portfolio-zip-", dir=selection)
                os.close(descriptor)
                try:
                    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as output:
                        for relative, content, _ in selected:
                            info = zipfile.ZipInfo(relative.as_posix(), date_time=(2026, 10, 12, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = (stat.S_IFREG | 0o644) << 16
                            output.writestr(info, content)
                        for name, content in (("NATIVE_INPUTS.json", encode(manifest)), ("RECEIVED.json", encode(receipt))):
                            info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = (stat.S_IFREG | 0o644) << 16
                            output.writestr(info, content)
                    with open(temporary, "rb") as stream:
                        os.fsync(stream.fileno())
                    os.link(temporary, archive, follow_symlinks=False)
                    os.unlink(temporary)
                    sync_directory(selection)
                finally:
                    if os.path.lexists(temporary):
                        os.unlink(temporary)
            with zipfile.ZipFile(archive) as saved:
                require(saved.testzip() is None, "The input ZIP checksum differs.")
                for relative, content, _ in selected:
                    require(saved.read(relative.as_posix()) == content,
                            "The saved input ZIP source differs: " + relative.as_posix())
            result["archive"] = {"path": str(archive), **file_identity(original_bytes(archive))}
        return result
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="The complete published input JSON, or - for stdin.")
    parser.add_argument("--sha256", required=True, help="Published SHA-256 of the complete input JSON bytes.")
    parser.add_argument("--directory", required=True, help="The same original operation directory.")
    parser.add_argument("--zip", action="store_true", help="Retain a complete portable input ZIP beside its receipt.")
    args = parser.parse_args()
    try:
        result = receive(args.input, args.sha256, args.directory, args.zip)
    except (InputError, ValueError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"state": "INPUT_ERROR", "error": str(exc)}), file=sys.stderr, flush=True)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
