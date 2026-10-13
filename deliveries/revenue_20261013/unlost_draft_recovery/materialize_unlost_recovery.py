#!/usr/bin/env python3
"""Restore the complete original Unlost recovery delivery with Python's standard library."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re

PUBLIC = {"json":{"bytes":5249805,"sha256":"c2b3542b7ebcecc71170ac4f105bd6914d8175dba327eabdcef4f025c7713a34"},"gzip":{"bytes":1644984,"sha256":"558b097bcfddd1156cdc4ccf95fc3cc8e7aebc4660f4726e723147118e5eea94"},"base64":{"bytes":2193312,"sha256":"58c1be0f6153c4c0cece2de35e62b2f4673e476d892e9002339583915d957a7d"},"files":66}
PRIVATE = {"bytes":5269890,"sha256":"8db87c6d21bbc9a11f1c2acd7ab381d2662642f56265d44b158cb8d6dd8f3b00"}

def exact(data, expected, label):
    if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
        raise ValueError(label + " bytes or SHA256 differ")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    carrier = parser.add_mutually_exclusive_group(required=True)
    carrier.add_argument("--base64", type=Path)
    carrier.add_argument("--gzip", type=Path)
    parser.add_argument("--private-complement", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists():
        raise ValueError("Choose a new private output directory; no existing work is overwritten")
    if args.base64:
        encoded = b"".join(args.base64.read_bytes().split())
        exact(encoded, PUBLIC["base64"], "Canonical Base64 carrier")
        compressed = base64.b64decode(encoded, validate=True)
    else:
        compressed = args.gzip.read_bytes()
    exact(compressed, PUBLIC["gzip"], "Original gzip carrier")
    public_raw = gzip.decompress(compressed)
    exact(public_raw, PUBLIC["json"], "Complete public source bank")
    public = json.loads(public_raw)
    complement_text = args.private_complement.read_text(encoding="utf-8")
    if not complement_text.lstrip().startswith("{"):
        blocks = re.findall(r"\x60\x60\x60json\s*\n([\s\S]*?)\x60\x60\x60", complement_text)
        if len(blocks) != 1:
            raise ValueError("Retain the whole private complement JSON or its complete Canvas Markdown")
        complement_text = blocks[0]
    complement = json.loads(complement_text)
    if complement.get("schema") != "unlost.complete-private-source-complement.v1":
        raise ValueError("Use the original private complement")
    descriptor = complement["public_source"]
    for key in ("json", "gzip", "base64"):
        if descriptor[key] != PUBLIC[key]:
            raise ValueError("The private complement selects a different public source")
    start, length = descriptor["files_array_offset"], descriptor["files_array_bytes"]
    if not isinstance(start, int) or not isinstance(length, int) or start < 0 or length < 1:
        raise ValueError("The original source-array position is invalid")
    array = public_raw[start:start + length]
    if len(array) != length or json.loads(array) != public["files"]:
        raise ValueError("The complete source array differs")
    complete = complement["prefix_utf8"].encode("ascii") + array + complement["suffix_utf8"].encode("ascii")
    if complement["complete_private_packet"] != PRIVATE:
        raise ValueError("The original full packet identity differs")
    exact(complete, PRIVATE, "Complete reconstructed private packet")
    bank = json.loads(complete)
    if bank["files"] != public["files"] or len(bank["files"]) != 66:
        raise ValueError("All 66 original source members are required")
    pending, seen = [], set()
    for member in bank["files"]:
        name = member["path"]
        relative = PurePosixPath(name)
        if not isinstance(name, str) or relative.is_absolute() or "\\" in name or "\x00" in name or ".." in relative.parts or not relative.parts or relative.as_posix() != name or name in seen:
            raise ValueError("Unsafe or duplicate original source path")
        seen.add(name)
        data = member["content"].encode("utf-8")
        exact(data, {"bytes": member["bytes"], "sha256": member["sha256"]}, name)
        pending.append((relative, data))
    # Every whole-packet and member identity is checked before any output is created.
    out.mkdir(parents=True, mode=0o700)
    source = out / "source"
    source.mkdir(mode=0o700)
    for relative, data in pending:
        target = source.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open("xb") as stream:
            stream.write(data)
        os.chmod(target, 0o600)
    packet = out / "complete-private-source-bank.json"
    with packet.open("xb") as stream:
        stream.write(complete)
    os.chmod(packet, 0o600)
    receipt = {"source": str(source), "complete_private_packet": str(packet), "packet": PRIVATE,
               "files": len(pending), "source_commit": public["source_commit"],
               "browser_course": str(source / "localization/run-existing-browser.mjs"),
               "actual_browser_result": "not executed by materialization"}
    print(json.dumps(receipt, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
