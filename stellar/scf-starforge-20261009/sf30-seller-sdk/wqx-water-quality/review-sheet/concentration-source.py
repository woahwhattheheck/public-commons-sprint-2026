#!/usr/bin/env python3
"""Receive the exact retained Potomac source graph with the standard ZIP reader."""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

def need(value, message):
    if not value:
        raise ValueError(message)

def sha(value):
    return hashlib.sha256(value).hexdigest()

def private_directory(path):
    path = Path(path)
    need(path.is_absolute() and path != Path("/"), "Use an absolute private source directory")
    if not path.exists():
        path.mkdir(mode=0o700, parents=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path,
         "The original source directory must be real")
    need(info.st_uid == os.getuid() and not info.st_mode & 0o077,
         "Use the operator's private source directory")
    return path

def member_path(name):
    need(isinstance(name, str) and name and "\\" not in name and "\0" not in name, "Invalid source member")
    path = PurePosixPath(name)
    need(not path.is_absolute() and all(part not in ("", ".", "..") for part in path.parts)
         and str(path) == name, "Keep source members inside the original graph")
    return path

def immutable(path, data):
    private_directory(path.parent)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            existing = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(existing, "rb") as stream:
                info = os.fstat(stream.fileno())
                need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
                     "An existing graph member must remain a private regular file")
                need(stream.read() == data, "An existing original graph member differs: " + str(path))
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        os.unlink(temporary)

def receive(source, expected, destination):
    need(len(expected) == 64 and all(c in "0123456789abcdef" for c in expected),
         "Bind the complete retained source carrier SHA-256")
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 8 * 1024 * 1024,
             "Choose the complete original source carrier")
        data = stream.read()
        after = os.fstat(stream.fileno())
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
             == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "The source carrier changed while reading")
    need(sha(data) == expected, "The selected source carrier changed")
    wrapper = json.loads(data)
    need(wrapper["schema"] == "starforge.wqx-retained-source-carrier.v1"
         and wrapper["encoding"] == "base64", "Use the retained original source-graph carrier")
    compressed = base64.b64decode(wrapper["content"], validate=True)
    need(len(compressed) == wrapper["bytes"] and sha(compressed) == wrapper["sha256"],
         "The complete original ZIP differs from its retained descriptor")
    manifest = wrapper["manifest"]
    need(manifest["schema"] == "starforge.wqx-retained-receiving-graph.v1",
         "Use the original receiving-graph manifest")
    members = manifest["members"]
    need(isinstance(members, list) and 1 <= len(members) <= 256, "Invalid source member count")
    selected = {}
    for member in members:
        name = str(member_path(member["path"]))
        need(name not in selected and name != "SOURCE_GRAPH.json", "Duplicate original source member")
        need(isinstance(member["bytes"], int) and 0 <= member["bytes"] <= 64 * 1024 * 1024,
             "The original member exceeds its source bound")
        selected[name] = member
    need(sum(row["bytes"] for row in members) <= 128 * 1024 * 1024, "The graph exceeds its retained bound")
    root = private_directory(Path(destination).absolute())
    with zipfile.ZipFile(io.BytesIO(compressed)) as archive:
        entries = archive.infolist()
        need(len(entries) == len(selected) + 1 and len({row.filename for row in entries}) == len(entries),
             "The complete source ZIP has repeated or additional members")
        need({row.filename for row in entries} == set(selected) | {"SOURCE_GRAPH.json"},
             "The source ZIP member graph differs")
        for entry in entries:
            member_path(entry.filename)
            need(not entry.is_dir() and not stat.S_ISLNK(entry.external_attr >> 16)
                 and not entry.flag_bits & 1, "Use regular original source members")
            if entry.filename == "SOURCE_GRAPH.json":
                need(entry.file_size <= 512 * 1024, "The retained manifest is too large")
                need(json.loads(archive.read(entry)) == manifest, "The original source manifest differs")
                continue
            expected_member = selected[entry.filename]
            need(entry.file_size == expected_member["bytes"], "The original member length differs")
            member = archive.read(entry)
            need(sha(member) == expected_member["sha256"], "The original member digest differs")
        for entry in entries:
            relative = member_path(entry.filename)
            parent = root
            for part in relative.parts[:-1]:
                parent = private_directory(parent / part)
            path = parent / relative.parts[-1]
            immutable(path, archive.read(entry))
    result = {"schema": "starforge.wqx-source-graph-received.v1", "sourceCarrierSha256": expected,
              "archiveSha256": wrapper["sha256"], "sourceCommit": manifest["sourceCommit"],
              "members": len(entries), "originalBytes": sum(row["bytes"] for row in members),
              "directory": str(root)}
    immutable(root / "received.json", (json.dumps(result, sort_keys=True, indent=2) + "\n").encode())
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    print(json.dumps(receive(args.source, args.sha256, args.directory), sort_keys=True), flush=True)

if __name__ == "__main__":
    main()
