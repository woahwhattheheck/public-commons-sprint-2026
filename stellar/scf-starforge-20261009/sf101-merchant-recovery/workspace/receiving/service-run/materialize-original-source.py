#!/usr/bin/env python3
"""Materialize the complete pinned SCF recovery application from published parts."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile

REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
COMMIT = "986bc2379e892ee721de30a0b88701461a0dffd6"
INDEX_SHA256 = "84834fec49e5f40f1bea1b5770745263a81e528a0e4153f49efef8c2721b706c"

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(body):
    return hashlib.sha256(body).hexdigest()

def git(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()

def safe_name(value):
    require(isinstance(value, str) and value, "Missing original source path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and str(path) == value and "\\" not in value
            and all(p not in ("", ".", "..") for p in path.parts), "Noncanonical original source path")
    return value

def checked(path, expected):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode), "Select a regular original source file")
    body = path.read_bytes()
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "Original source changed during read")
    require(len(body) == expected["bytes"] and sha(body) == expected["sha256"]
            and git(body) == expected.get("blob", expected.get("git_blob_sha")), "Original source body differs: " + str(path))
    return body

def publish(path, body, mode):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink():
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == body,
                "Preserve different existing source: " + str(path))
    else:
        fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(body); output.flush(); os.fsync(output.fileno())
            os.link(name, path)
        finally:
            os.unlink(name)
    path.chmod(mode)

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--journey", required=True, type=Path)
    args = parser.parse_args()
    package = args.package.resolve(strict=True)
    source, journey = args.source, args.journey
    require(source.is_absolute() and str(source.resolve()) == str(source), "Use a canonical absolute source directory")
    require(journey.is_absolute() and str(journey.resolve()) == str(journey), "Use a canonical absolute journey path")
    require(not source.is_relative_to(package) and not package.is_relative_to(source),
            "Materialize the original source beside the package")
    raw = (package / "source-index.json").read_bytes()
    require(len(raw) == 699722 and sha(raw) == INDEX_SHA256, "Use the published complete source index")
    index = json.loads(raw)
    manifest = index["manifest"]
    require(manifest["repository"] == REPOSITORY and manifest["commit"] == COMMIT, "Keep the original application edition")
    rows = {safe_name(row["path"]): row for row in manifest["files"]}
    require(len(rows) == len(manifest["files"]) == 1682, "Keep the complete original file set")
    files = {}
    for ordinal, part in enumerate(index["parts"], 1):
        body = checked(package / "parts" / ("%03d.json" % ordinal), part)
        values = json.loads(body)["files"]
        names = [safe_name(value["path"]) for value in values]
        require(len(names) == len(set(names)) and set(names) == set(part["files"]), "Original part membership differs")
        for value in values:
            name = value["path"]
            require(name in rows and name not in files, "Duplicate or unselected original member")
            content = value["content"].encode("utf-8")
            row = rows[name]
            require(len(content) == row["bytes"] and sha(content) == row["sha256"]
                    and git(content) == row["git_blob_sha"], "Original source identity differs: " + name)
            files[name] = content
    require(set(files) == set(rows), "Keep every original application file")
    original = index["standalone_sources"][0]
    require(original["blob"] == "76e306e88e1654c66afb2ec225853badeb64c3cf", "Keep the original standalone journey")
    journey_body = checked(package / "recovery-journey.mjs", original)
    marker_body = (json.dumps({"schema": "scf-original-source-materialization/v1", "repository": REPOSITORY,
                    "commit": COMMIT, "index_sha256": INDEX_SHA256, "files": len(rows),
                    "source_bytes": sum(row["bytes"] for row in rows.values())}, sort_keys=True, indent=2) + "\n").encode()
    marker = source / ".original-source.json"
    if source.exists():
        require(source.is_dir() and not source.is_symlink() and marker.is_file()
                and marker.read_bytes() == marker_body, "Use the same owned materialization or a new source directory")
    else:
        source.mkdir(mode=0o700)
        publish(marker, marker_body, 0o400)
    for name, content in files.items():
        publish(source / name, content, 0o555 if rows[name].get("mode") == "100755" else 0o444)
    publish(journey, journey_body, 0o444)
    for directory, _, _ in os.walk(source, topdown=False):
        Path(directory).chmod(0o555)
    print(json.dumps({"state": "SOURCE_READY", "repository": REPOSITORY, "commit": COMMIT,
                      "files": len(rows), "source_bytes": sum(row["bytes"] for row in rows.values()),
                      "source": str(source), "journey": str(journey), "journey_git_blob": git(journey_body),
                      "index_sha256": INDEX_SHA256}, sort_keys=True), flush=True)

if __name__ == "__main__":
    main()
