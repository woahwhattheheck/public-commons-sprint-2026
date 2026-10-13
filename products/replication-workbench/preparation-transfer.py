#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Transfer the complete selected application and unchanged original Sling archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile

SCHEMA = "stellar-forge.replication-workbench-transfer.v1"
ENGINE_BYTES = 121317497
ENGINE_SHA = "e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66"
MAX_TRANSFER = 256 * 1024 * 1024

def require(ok, message):
    if not ok:
        raise ValueError(message)

def identity(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, "Use canonical absolute files.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), "Use an original regular file.")
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(os.dup(fd), "rb") as stream:
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                digest.update(block)
                size += len(block)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and size == before.st_size, "Original file changed while reading.")
        return {"path": str(path), "bytes": size, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)

def verify(path, selected):
    actual = identity(path)
    require(actual["bytes"] == selected["bytes"] and actual["sha256"] == selected["sha256"],
            "Original complete identity differs: " + str(path))
    return actual

def private(path):
    path = Path(path)
    require(path.is_absolute(), "Use an absolute directory.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    s = path.lstat()
    require(stat.S_ISDIR(s.st_mode) and path.resolve() == path and not s.st_mode & 0o077
            and s.st_uid == os.getuid(), "Use an owned canonical private directory.")
    return path

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def sync_tree(path):
    for home, dirs, files in os.walk(path, topdown=False):
        for name in dirs:
            require(not (Path(home) / name).is_symlink(), "Staged directory contains a symlink.")
        sync_directory(Path(home))

def selection(manifest_path, manifest_sha):
    actual = identity(manifest_path)
    require(actual["sha256"] == manifest_sha and actual["bytes"] <= 1024 * 1024,
            "Use the installed exact source selection.")
    manifest = json.loads(Path(manifest_path).read_bytes())
    require(manifest["schema"] == "stellar-forge.replication-workbench-original-source.v1"
            and len(manifest["files"]) == 70, "Select the complete original70 source.")
    names = set()
    for item in manifest["files"]:
        name = item["path"]
        require(isinstance(name, str) and name and "\\" not in name and
                all(p not in ("", ".", "..") for p in name.split("/")) and
                not name.startswith("/") and name not in names, "Invalid source member.")
        require(isinstance(item["bytes"], int) and 0 <= item["bytes"] <= 32 * 1024 * 1024
                and len(item["sha256"]) == 64, "Invalid source identity.")
        names.add(name)
    return manifest, actual

def source_members(manifest):
    return [{"path": "application/" + row["path"], "bytes": row["bytes"],
             "sha256": row["sha256"]} for row in manifest["files"]]

def description(manifest, manifest_sha):
    return {"schema": SCHEMA, "sourceManifestSha256": manifest_sha,
            "members": source_members(manifest) +
            [{"path": "sling_linux_amd64.tar.gz", "bytes": ENGINE_BYTES, "sha256": ENGINE_SHA}]}

def bytes_for(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def current_source(directory, manifest):
    directory = Path(directory)
    require(directory.resolve() == directory, "Use the canonical original application.")
    wanted = {row["path"] for row in manifest["files"]}
    actual = set()
    for home, dirs, files in os.walk(directory):
        for name in dirs[:]:
            entry = Path(home) / name
            require(not entry.is_symlink(), "Source contains a symlink.")
            if name == "__pycache__":
                dirs.remove(name)
        for name in files:
            path = Path(home) / name
            rel = path.relative_to(directory).as_posix()
            require(not path.is_symlink() and rel in wanted, "Source contains an extra member: " + rel)
            actual.add(rel)
    require(actual == wanted, "Source is incomplete.")
    for row in manifest["files"]:
        verify(directory / row["path"], row)

def copy_source(source, output, manifest):
    source, output = Path(source), Path(output)
    current_source(source, manifest)
    parent = private(output.parent)
    if output.exists():
        current_source(output, manifest)
        sync_tree(output)
        sync_directory(parent)
        return {"applicationDirectory": str(output), "files": len(manifest["files"])}
    stage = Path(tempfile.mkdtemp(prefix=".source-", dir=parent))
    try:
        for row in manifest["files"]:
            target = stage / row["path"]
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with open(source / row["path"], "rb") as src, open(target, "xb") as dst:
                os.chmod(target, 0o600)
                shutil.copyfileobj(src, dst, 1024 * 1024)
                dst.flush()
                os.fsync(dst.fileno())
            verify(target, row)
        current_source(stage, manifest)
        sync_tree(stage)
        os.rename(stage, output)
        sync_directory(output)
        sync_directory(parent)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {"applicationDirectory": str(output), "files": len(manifest["files"])}

def inspect_transfer(archive, manifest, manifest_sha, extract=None):
    selected = identity(archive)
    require(selected["bytes"] <= MAX_TRANSFER, "Transfer exceeds its complete installed limit.")
    expected = description(manifest, manifest_sha)
    metadata = bytes_for(expected)
    rows = {row["path"]: row for row in expected["members"]}
    rows["TRANSFER.json"] = {"bytes": len(metadata), "sha256": hashlib.sha256(metadata).hexdigest()}
    seen = set()
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            require(member.isfile() and member.name in rows and member.name not in seen,
                    "Unknown, linked, duplicate or nonregular transfer member.")
            want = rows[member.name]
            require(member.size == want["bytes"], "Complete transfer member length differs.")
            seen.add(member.name)
            digest = hashlib.sha256()
            count = 0
            stream = tar.extractfile(member)
            target = None
            try:
                if extract is not None:
                    path = extract / member.name
                    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    target = open(path, "xb")
                    os.chmod(path, 0o600)
                while True:
                    block = stream.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    require(count <= want["bytes"], "Transfer member exceeds selection.")
                    digest.update(block)
                    if target is not None:
                        target.write(block)
                require(count == want["bytes"] and digest.hexdigest() == want["sha256"],
                        "Complete transfer member hash differs.")
                if target is not None:
                    target.flush()
                    os.fsync(target.fileno())
            finally:
                if stream is not None:
                    stream.close()
                if target is not None:
                    target.close()
    require(seen == set(rows), "Complete application or original engine is missing.")
    require(identity(archive) == selected, "Transfer changed during receiving.")
    return selected

def pack(source, engine, output, manifest, manifest_sha):
    source, output = Path(source), Path(output)
    current_source(source, manifest)
    verify(engine, {"bytes": ENGINE_BYTES, "sha256": ENGINE_SHA})
    parent = private(output.parent)
    if output.exists():
        return inspect_transfer(output, manifest, manifest_sha)
    fd, temporary_name = tempfile.mkstemp(prefix=".transfer-", dir=parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with tarfile.open(temporary, "w:gz", compresslevel=1) as tar:
            metadata = bytes_for(description(manifest, manifest_sha))
            import io
            info = tarfile.TarInfo("TRANSFER.json")
            info.size, info.mode, info.mtime = len(metadata), 0o600, 0
            tar.addfile(info, io.BytesIO(metadata))
            for row in description(manifest, manifest_sha)["members"]:
                path = source / row["path"][12:] if row["path"].startswith("application/") else Path(engine)
                verify(path, row)
                info = tarfile.TarInfo(row["path"])
                info.size, info.mode, info.mtime = row["bytes"], 0o600, 0
                with open(path, "rb") as stream:
                    tar.addfile(info, stream)
        with open(temporary, "rb") as stream:
            os.fsync(stream.fileno())
        inspect_transfer(temporary, manifest, manifest_sha)
        os.link(temporary, output)
        sync_directory(parent)
    finally:
        temporary.unlink(missing_ok=True)
    return identity(output)

def receive(archive, output, manifest, manifest_sha):
    output = Path(output)
    parent = private(output.parent)
    selected = inspect_transfer(archive, manifest, manifest_sha)
    if output.exists():
        current_source(output / "application", manifest)
        verify(output / "sling_linux_amd64.tar.gz", {"bytes": ENGINE_BYTES, "sha256": ENGINE_SHA})
        require((output / "TRANSFER.json").read_bytes() == bytes_for(description(manifest, manifest_sha)),
                "Receiving source selection differs.")
        sync_tree(output)
        sync_directory(parent)
        return {"directory": str(output), "portable": selected}
    stage = Path(tempfile.mkdtemp(prefix=".receiving-", dir=parent))
    try:
        inspect_transfer(archive, manifest, manifest_sha, extract=stage)
        current_source(stage / "application", manifest)
        sync_tree(stage)
        os.rename(stage, output)
        sync_directory(output)
        sync_directory(parent)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {"directory": str(output), "portable": selected}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["source", "pack", "receive", "inspect"])
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--source")
    parser.add_argument("--engine")
    parser.add_argument("--archive")
    parser.add_argument("--output")
    args = parser.parse_args()
    manifest, selected = selection(args.manifest, args.manifest_sha256)
    if args.operation == "source":
        result = copy_source(args.source, args.output, manifest)
    elif args.operation == "pack":
        result = pack(args.source, args.engine, args.output, manifest, selected["sha256"])
    elif args.operation == "receive":
        result = receive(args.archive, args.output, manifest, selected["sha256"])
    else:
        result = inspect_transfer(args.archive, manifest, selected["sha256"])
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    main()
