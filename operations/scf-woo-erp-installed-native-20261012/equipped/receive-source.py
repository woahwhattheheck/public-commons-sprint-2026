#!/usr/bin/env python3
"""Receive the exact original installed Woo ERP source in one owned directory."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import stat
import zipfile

SOURCE_COMMIT = "b39da9bbf56ef4bdbd8d81513966ac636fed6c7a"
ARCHIVE_SHA256 = "992c0d8901d0fef531e7f9cfb4b7fdd928423f897f7dcd7d4c4b5eccf181001f"
MANIFEST_SHA256 = "450c198a644ef1acdf8762f01a446794224e98eb62cee32a1dc76e5af2ba6166"
SCHEMA = "commons.woo-erp.installed-source.v1"


def sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def regular(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("Expected an original regular file: " + str(path))


def publish(path, data, mode=0o600):
    if path.exists() or path.is_symlink():
        regular(path)
        if path.read_bytes() != data:
            raise ValueError("The existing original file changed: " + str(path))
        return
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if parent.resolve() != parent.absolute():
        raise ValueError("Source receiving directories must retain their exact paths.")
    temporary = path.with_name(path.name + ".receiving-" + secrets.token_hex(8))
    try:
        with temporary.open("xb") as target:
            os.chmod(temporary, mode)
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def receive(archive, directory):
    archive, root = Path(archive).absolute(), Path(directory).absolute()
    regular(archive)
    if archive.stat().st_size != 3315202 or sha(archive) != ARCHIVE_SHA256:
        raise ValueError("Select the complete original b39 installed-source archive.")
    if root.is_symlink() or root.resolve() != root:
        raise ValueError("Select an exact source directory with no symlink ancestors.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not root.is_dir() or stat.S_IMODE(root.stat().st_mode) & 0o077:
        raise ValueError("Use an original private source directory.")
    owner = root / "source-owner.json"
    lock_path = root / "source-receiving.lock"
    if not owner.exists() and any(path != lock_path for path in root.iterdir()):
        raise ValueError("Select a new directory or this same retained source owner.")
    if lock_path.is_symlink():
        raise ValueError("The original source lease cannot be a link.")
    with lock_path.open("a+b") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with zipfile.ZipFile(archive) as source:
            infos = source.infolist()
            names = [info.filename for info in infos]
            if len(names) != 320 or len(set(names)) != len(names):
                raise ValueError("Original source member inventory changed.")
            manifest_bytes = source.read("source-manifest.json")
            if hashlib.sha256(manifest_bytes).hexdigest() != MANIFEST_SHA256:
                raise ValueError("Original source manifest changed.")
            manifest = json.loads(manifest_bytes)
            if manifest["schema"] != SCHEMA or manifest["sourceCommit"] != SOURCE_COMMIT:
                raise ValueError("Another original source edition was supplied.")
            members = manifest["files"]
            expected = {member["path"] for member in members} | {"source-manifest.json"}
            if set(names) != expected or len(members) != 319:
                raise ValueError("Source archive and retained manifest disagree.")
            for info in infos:
                path = PurePosixPath(info.filename)
                if (info.is_dir() or path.is_absolute() or ".." in path.parts
                        or "\\" in info.filename or str(path) != info.filename
                        or info.flag_bits & 1 or info.compress_type != zipfile.ZIP_STORED
                        or not stat.S_ISREG(info.external_attr >> 16)):
                    raise ValueError("Source member is not an exact original file.")
            identity = {
                "schema": SCHEMA + ".owner", "sourceCommit": SOURCE_COMMIT,
                "archiveSha256": ARCHIVE_SHA256, "manifestSha256": MANIFEST_SHA256,
                "directory": str(root)
            }
            publish(owner, (json.dumps(identity, indent=2) + "\n").encode())
            for member in members:
                data = source.read(member["path"])
                git = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                if (len(data) != member["bytes"]
                        or hashlib.sha256(data).hexdigest() != member["sha256"]
                        or git != member["gitBlob"]
                        or member["gitMode"] not in ("100644", "100755")):
                    raise ValueError("Original source bytes changed: " + member["path"])
                publish(root / member["path"], data,
                        mode=0o700 if member["gitMode"] == "100755" else 0o600)
            publish(root / "source-manifest.json", manifest_bytes)
            result = {
                "schema": SCHEMA + ".received", "sourceCommit": SOURCE_COMMIT,
                "directory": str(root), "sourceFiles": len(members),
                "sourceBytes": sum(member["bytes"] for member in members),
                "archiveSha256": ARCHIVE_SHA256, "manifestSha256": MANIFEST_SHA256,
                "entrypoint": str(root / manifest["entrypoint"]),
                "dependencyDirectory": str(root / "stellar-forge/payment-auto-catalog"),
                "phases": manifest["phases"], "configuredProvider": manifest["configuredProvider"]
            }
            publish(root / "source-receiving.json", (json.dumps(result, indent=2) + "\n").encode())
            return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("directory")
    args = parser.parse_args()
    print(json.dumps(receive(args.archive, args.directory), indent=2))
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
