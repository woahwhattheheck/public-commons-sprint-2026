#!/usr/bin/env python3
"""Read complete ordinary TAR or tar.gz source through Python's standard library.

This trusted tool never imports members, follows archive links, or calls extractall.
Original compressed bytes and effective TAR metadata remain in the source packet.
"""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_ENTRIES = 8192

def need(value, message):
    if not value:
        raise ValueError(message)

def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

def read_original(filename):
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_ARCHIVE,
             "Select a complete ordinary archive within 128 MiB")
        with os.fdopen(os.dup(descriptor), "rb") as source:
            raw = source.read(MAX_ARCHIVE + 1)
        after = os.fstat(descriptor)
        need(len(raw) == before.st_size and
             (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "Original archive changed while reading")
        return raw
    finally:
        os.close(descriptor)

def member_path(name, directory):
    need(isinstance(name, str) and len(name.encode("utf-8", "strict")) <= 4096,
         "TAR member name must be complete bounded UTF-8")
    original = name
    need(not name.startswith("/") and "\\" not in name and
         not any(ord(c) < 32 or ord(c) == 127 for c in name),
         "Absolute, backslash or control-containing TAR member name")
    while name.startswith("./"):
        name = name[2:]
    if directory:
        name = name.rstrip("/")
    if directory and name in ("", "."):
        need(original in (".", "./") or set(original) <= {".", "/"},
             "Invalid TAR root directory")
        return "."
    need(name and not name.endswith("/"), "Empty or invalid TAR file name")
    parts = name.split("/")
    for part in parts:
        need(part not in ("", ".", "..") and not re.search(r'[<>:"|?*]', part) and
             not part.endswith((" ", ".")) and
             not re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)", part, re.I),
             "TAR member cannot be received without renaming: " + original)
    return name

def inspect_archive(filename, expected, selected_format):
    need(re.fullmatch(r"[a-f0-9]{64}", expected or "") is not None, "Supply the original archive SHA-256")
    raw = read_original(filename)
    need(hashlib.sha256(raw).hexdigest() == expected, "Original TAR identity differs")
    need(selected_format in ("tar", "tar.gz"), "Select tar or tar.gz explicitly")
    if selected_format == "tar.gz":
        need(raw[:2] == bytes((31, 139)), "Selected tar.gz has no gzip header")
        with gzip.GzipFile(fileobj=io.BytesIO(raw), mode="rb") as source:
            expanded = source.read(MAX_EXPANDED + 1)
            need(len(expanded) <= MAX_EXPANDED, "Complete expanded TAR exceeds 128 MiB")
            need(source.read(1) == b"", "Complete expanded TAR exceeds its bound")
    else:
        expanded = raw
    need(len(expanded) >= 1024 and len(expanded) % 512 == 0 and len(expanded) <= MAX_EXPANDED,
         "Complete TAR must contain aligned blocks and its end marker")
    entries = []
    explicit = set()
    folded = {}
    files = set()
    directories = {"."}
    logical_bytes = 0
    cursor = 0
    with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:", encoding="utf-8", errors="strict",
                      ignore_zeros=False) as archive:
        for member in archive:
            need(len(entries) < MAX_ENTRIES, "Complete archive has too many members")
            # Python handles PAX/GNU names and numeric fields; only ordinary source
            # files/directories are receivable. Do not silently drop other kinds.
            need(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE) and
                 member.sparse is None, "Unsupported TAR member kind: " + member.name)
            need(not any("sparse" in k.lower() for k in member.pax_headers),
                 "Sparse TAR source is not supported")
            directory = member.type == tarfile.DIRTYPE
            name = member_path(member.name, directory)
            need(name not in explicit, "Repeated effective TAR member path: " + name)
            explicit.add(name)
            need(isinstance(member.mode, int) and 0 <= member.mode <= 0o7777,
                 "Unsupported TAR permissions")
            need(isinstance(member.size, int) and 0 <= member.size <= MAX_EXPANDED,
                 "Invalid TAR member size")
            need(not directory or member.size == 0, "Directory has TAR file payload")
            if name != ".":
                pieces = name.split("/")
                for n in range(1, len(pieces) + 1):
                    part = "/".join(pieces[:n])
                    key = part.casefold()
                    need(key not in folded or folded[key] == part, "Case-alias TAR member path")
                    folded[key] = part
                    if n < len(pieces):
                        need(part not in files, "TAR parent is an ordinary file")
                        directories.add(part)
                if directory:
                    need(name not in files, "TAR directory replaces a file")
                    directories.add(name)
                else:
                    need(name not in directories, "TAR file replaces a directory")
                    files.add(name)
            logical_bytes += member.size
            need(logical_bytes <= MAX_EXPANDED, "Complete TAR member bytes exceed 128 MiB")
            end = member.offset_data + ((member.size + 511) // 512) * 512
            need(0 <= member.offset <= member.offset_data <= end <= len(expanded),
                 "TAR member exceeds the complete archive")
            cursor = end
            data = b""
            if not directory:
                source = archive.extractfile(member)
                need(source is not None, "TAR file has no readable original payload")
                with source:
                    data = source.read(member.size + 1)
                need(len(data) == member.size, "TAR file payload is incomplete")
            # Exact original headers remain in raw archive; PAX metadata is retained
            # separately so effective names do not masquerade as rewritten originals.
            entries.append({"path": name, "effectiveName": member.name,
                "headerNameBase64": base64.b64encode(expanded[member.offset_data - 512:member.offset_data - 412]).decode("ascii"),
                "headerPrefixBase64": base64.b64encode(expanded[member.offset_data - 167:member.offset_data - 12]).decode("ascii"),
                "kind": "directory" if directory else "file", "mode": member.mode,
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "dataBase64": base64.b64encode(data).decode("ascii"),
                "headerOffset": member.offset, "dataOffset": member.offset_data,
                "uid": str(member.uid), "gid": str(member.gid), "mtime": str(member.mtime),
                "uname": member.uname, "gname": member.gname,
                "paxHeaders": member.pax_headers})
        # An end marker is mandatory. Trailing records must all be zero, never
        # a hidden second archive or ignored invalid header after the first member.
        need(expanded[cursor:cursor + 1024] == bytes(1024) and
             all(b == 0 for b in expanded[cursor:]),
             "TAR end marker or zero-only trailing padding is incomplete")
    return {"status": "COMPLETE", "schema": "commons.tar-archive.v1",
        "archive": {**identity(raw), "format": selected_format,
                    "expandedBytes": len(expanded), "uncompressedBytes": logical_bytes},
        "entries": entries, "applicationExecution": False}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--format", choices=("tar", "tar.gz"), required=True)
    args = parser.parse_args(argv)
    value = inspect_archive(args.archive, args.sha256, args.format)
    output = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    need(len(output) + 1 <= 256 * 1024 * 1024, "Complete TAR view exceeds the original parser output bound")
    print(output)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
