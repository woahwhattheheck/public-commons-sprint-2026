#!/usr/bin/env python3
"""Stage this exact retained source packet for the original Git object receiver."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid
import zlib

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PROJECT = Path("/workspace/scratch/b3909ae247f2/stellar-expert-mcp-receiving")
INPUTS_LIMIT = 32 * 1024
PACKET_LIMIT = 2 * 1024 * 1024
DECODED_LIMIT = 3 * 1024 * 1024
OID = re.compile(r"^[0-9a-f]{40}$")


def need(value, message):
    if not value:
        raise ValueError(message)


def bounded(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
             "Expected a bounded regular input: " + str(path))
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        after = os.fstat(fd)
        need(len(data) == before.st_size and
             (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
             "Input changed while it was read: " + str(path))
        return data
    finally:
        os.close(fd)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def blob_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def unpack(data, maximum, window):
    decoder = zlib.decompressobj(window)
    raw = decoder.decompress(data, maximum + 1)
    need(len(raw) <= maximum and decoder.eof and not decoder.unused_data and
         not decoder.unconsumed_tail, "Compressed input is incomplete or exceeds its declared bound")
    return raw


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_json(path, value):
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        os.close(fd)
        temporary.unlink(missing_ok=True)


def install_object(directory, oid, raw, file_limit):
    target = directory / (oid + ".blob.gz")
    def inspect():
        retained = unpack(bounded(target, file_limit + 65536), file_limit, 31)
        need(retained == raw and blob_id(retained) == oid,
             "Existing incoming object differs: " + oid)
        return target.stat(follow_symlinks=False).st_size
    try:
        return {"sha": oid, "bytes": len(raw), "compressedBytes": inspect(), "adopted": True}
    except FileNotFoundError:
        pass
    compressed = gzip.compress(raw, mtime=0)
    temporary = directory / ("." + oid + "." + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(compressed)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, target, follow_symlinks=False)
            adopted = False
        except FileExistsError:
            compressed_size = inspect()
            adopted = True
        sync_directory(directory)
    finally:
        os.close(fd)
        temporary.unlink(missing_ok=True)
    return {"sha": oid, "bytes": len(raw), "compressedBytes": compressed_size if adopted else len(compressed), "adopted": adopted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=PROJECT)
    parser.add_argument("--packet", type=Path, default=HERE / "source-incoming.json")
    parser.add_argument("--incoming", type=Path)
    parser.add_argument("--receive-cache", action="store_true",
                        help="Invoke the original receiver without materializing another source tree")
    parser.add_argument("--git", default="git")
    args = parser.parse_args()
    pins = json.loads(bounded(HERE / "INPUTS.json", INPUTS_LIMIT))
    need(pins.get("schema") == "commons.stellar-expert-original-source-recovery.v1",
         "Unexpected recovery input schema")
    project = args.project
    need(project.is_absolute() and project.resolve(strict=True) == project and project.is_dir(),
         "Use the original canonical project directory")
    need(str(project) == pins["project"], "This packet resumes its declared original project")
    receiver_path = project / pins["originalReceiver"]["path"]
    receiver_bytes = bounded(receiver_path, 128 * 1024)
    need(len(receiver_bytes) == pins["originalReceiver"]["bytes"] and
         digest(receiver_bytes) == pins["originalReceiver"]["sha256"] and
         blob_id(receiver_bytes) == pins["originalReceiver"]["gitBlob"],
         "The original Git object receiver changed; use its exact retained source")
    # This is the existing project's hash-verified engine, not code from the packet.
    spec = importlib.util.spec_from_file_location("original_source_receiver", receiver_path)
    receiver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(receiver)
    metadata_path = project / pins["metadataPath"]
    metadata_bytes = receiver.regular(metadata_path, receiver.METADATA_LIMIT)
    expected_metadata_hash = bounded(project / pins["metadataSha256Path"], 256).decode("ascii").strip()
    need(re.fullmatch(r"[0-9a-f]{64}", expected_metadata_hash) and
         digest(metadata_bytes) == expected_metadata_hash, "Original selected metadata bytes changed")
    metadata = json.loads(unpack(metadata_bytes, receiver.METADATA_LIMIT, 31)
                          if metadata_bytes.startswith(b"\x1f\x8b") else metadata_bytes)
    source, entries, selected, _ = receiver.validate_metadata(metadata)
    need(source["commit"] == pins["source"]["commit"] and source["tree"] == pins["source"]["tree"],
         "The original project selected a different source")
    cache = project / pins["cache"]
    previous = receiver.json_file(cache / "source-receiving.json")
    need(previous.get("source") == source and previous.get("directory") == str(cache) and
         previous.get("metadataSha256") == digest(receiver.canonical(metadata)),
         "Original cache and selected metadata differ")
    selected_paths = {row["path"] for row in selected} | set(previous.get("additionalPaths") or [])
    for path in selected_paths:
        row = entries.get(path)
        need(row and row["type"] == "blob" and row["mode"] in ("100644", "100755"),
             "Original cache includes an unsupported source path")
    selected_objects = {entries[path]["sha"] for path in selected_paths}

    packed = bounded(args.packet, PACKET_LIMIT)
    packet_pin = pins["packet"]
    need(len(packed) == packet_pin["bytes"] and digest(packed) == packet_pin["sha256"] and
         blob_id(packed) == packet_pin["gitBlob"], "Retained packet bytes do not match the published edition")
    packet = json.loads(packed)
    need(packet.get("schema") == "commons.original-git-incoming-packet.v1" and
         packet.get("source") == pins["source"] and packet.get("encoding") == "deflate-raw+base64",
         "Retained packet source or encoding differs")
    compressed = base64.b64decode(packet["data"], validate=True)
    need(len(compressed) == packet["compressedBytes"] == packet_pin["compressedBytes"] and
         digest(compressed) == packet["compressedSha256"], "Compressed body identity differs")
    decoded = unpack(compressed, DECODED_LIMIT, -15)
    need(len(decoded) == packet["decodedBytes"] == packet_pin["decodedBytes"] and
         digest(decoded) == packet["decodedSha256"] == packet_pin["decodedSha256"],
         "Decoded source body identity differs")
    body = json.loads(decoded)
    need(body.get("schema") == "commons.original-git-incoming-objects.v1" and
         body.get("source") == pins["source"] and isinstance(body.get("objects"), list),
         "Unexpected original-object inventory")
    prepared = {}
    for row in body["objects"]:
        oid, size, paths = row.get("sha"), row.get("size"), row.get("paths")
        need(isinstance(oid, str) and OID.fullmatch(oid) and oid not in prepared and
             oid in selected_objects and type(size) is int and 0 <= size <= receiver.FILE_LIMIT and
             isinstance(paths, list) and paths and len(paths) == len(set(paths)),
             "Invalid or unselected original source object")
        for path in paths:
            entry = entries.get(path)
            need(path in selected_paths and entry and entry["sha"] == oid and entry["size"] == size,
                 "Incoming object path differs from the original selected tree")
        raw = base64.b64decode(row["content_base64"], validate=True)
        need(len(raw) == size and blob_id(raw) == oid, "Incoming original Git blob identity differs")
        prepared[oid] = raw
    need(len(prepared) == packet["objects"] == packet_pin["objects"] and
         sum(map(len, prepared.values())) == packet["objectBytes"] == packet_pin["objectBytes"],
         "Incomplete retained object cohort")

    incoming = args.incoming or Path(pins["incoming"])
    receiver.absolute_directory(str(incoming), exists=False)
    incoming.mkdir(mode=0o700, parents=True, exist_ok=True)
    receiver.absolute_directory(str(incoming))
    lock = os.open(incoming / "incoming.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rows = [install_object(incoming, oid, raw, receiver.FILE_LIMIT)
                for oid, raw in prepared.items()]
        receipt = {
            "schema": "commons.original-source-incoming.v1",
            "source": pins["source"], "originalOperation": pins["originalOperation"],
            "originalRecord": pins["originalRecord"], "directory": str(incoming),
            "metadataSha256": expected_metadata_hash,
            "packet": packet_pin, "objects": rows,
            "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        save_json(incoming / "receipt.json", receipt)
        result = {"status": "STAGED", "objects": len(rows),
                  "bytes": sum(row["bytes"] for row in rows), "receipt": str(incoming / "receipt.json")}
        if args.receive_cache:
            command = [sys.executable, "-B", str(receiver_path), "--metadata", str(metadata_path),
                       "--commit", pins["source"]["commit"], "--directory", str(cache),
                       "--git", args.git, "--incoming", str(incoming)]
            available, absent = [], []
            for name in pins["donors"]:
                donor = Path(name)
                if donor.is_dir() and donor.resolve() == donor:
                    command += ["--donor-repository", name]
                    available.append(name)
                else:
                    absent.append(name)
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, env={**os.environ, "GIT_NO_LAZY_FETCH": "1",
                                                       "GIT_TERMINAL_PROMPT": "0"})
            original = {"exitCode": completed.returncode, "stdout": completed.stdout,
                        "stderr": completed.stderr, "availableDonors": available, "absentDonors": absent}
            save_json(incoming / "original-receiver-result.json", original)
            need(completed.returncode in (0, 2),
                 "Original cache receiver failed; its complete output is retained")
            observed = json.loads(completed.stdout)
            need(observed.get("source") == source and observed.get("directory") == str(cache),
                 "Original receiver returned a different source/cache")
            result.update(status="SOURCE_READY" if completed.returncode == 0 else "SOURCE_NEEDED",
                          receiver=observed, receiverResult=str(incoming / "original-receiver-result.json"))
        save_json(incoming / "result.json", result)
        print(json.dumps(result, separators=(",", ":")), flush=True)
        return 2 if result["status"] == "SOURCE_NEEDED" else 0
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "INCOMPLETE", "code": type(error).__name__, "message": str(error)}),
              file=sys.stderr, flush=True)
        raise SystemExit(1)
