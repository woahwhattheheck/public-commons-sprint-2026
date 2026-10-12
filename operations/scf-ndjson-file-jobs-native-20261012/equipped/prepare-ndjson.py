#!/usr/bin/env python3
"""Receive the complete original NDJSON file-job source on an existing native worker.

Uses the original 0B8D controller archive and its ordinary private-file receiving
contract. The product and publisher retain independent immutable Git commits.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
NATIVE_OPERATION = "SCF-NDJSON-FILE-JOBS-3AD791-20261012"
CONTROLLER_ARCHIVE = ROOT / "inbox/native-controller.tar.gz"
CONTROLLER_SHA256 = "9ab83b543b260efc13ebabb7e0a6c1474373e3af79ef00a194d6da84d41a55cb"
CONTROLLER_MANIFEST_SHA256 = "76ea745e526e8c73d1198867a7636ca7e0c1134cf2ae32d355c722e582a63b89"
SOURCE_ARCHIVE = "NDJSON_File_Jobs_Original_Source_20261012.zip"
SOURCE_BYTES = 3301268
SOURCE_SHA256 = "91659e8eaae0ed734041c7264bc48f675ec224fd2d8a5d4b0e447da38d04a74c"
PRODUCT_COMMIT = "1d01fe16eb66d06a18a61e59f7a66d859cc5caa3"
PUBLISHER_COMMIT = "b670ee2c460f2821b3af0cec9bcd70c5be365e3c"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"

def private_directory(path):
    if path != ROOT:
        if ROOT not in path.parents:
            raise RuntimeError("operation directory leaves its original root")
        private_directory(path.parent)
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("operation directory must remain private")
    if path != ROOT and ROOT not in path.resolve().parents:
        raise RuntimeError("operation path must remain inside its original directory")
    return path


def read_regular(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise RuntimeError("source is not the expected bounded regular file")
        body = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size,
                                 item.st_mtime_ns, item.st_ctime_ns)
        if len(body) > limit or identity(before) != identity(after):
            raise RuntimeError("source changed during receiving")
        return body


def checked(path, expected_bytes, expected_sha256):
    body = read_regular(path, expected_bytes)
    if len(body) != expected_bytes or hashlib.sha256(body).hexdigest() != expected_sha256:
        raise RuntimeError("source identity mismatch: " + str(path))
    return body


def publish(path, body):
    private_directory(path.parent)
    if path.exists() or path.is_symlink():
        if read_regular(path, len(body)) != body:
            raise RuntimeError("existing immutable source differs: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if read_regular(path, len(body)) != body:
                raise RuntimeError("concurrent immutable source differs: " + str(path))
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        os.unlink(temporary)


def relative_path(name):
    relative = PurePosixPath(name)
    if (not isinstance(name, str) or not name or relative.is_absolute()
            or ".." in relative.parts or not relative.parts
            or str(relative) != name or "\\" in name):
        raise RuntimeError("invalid received member path")
    return relative


def install_controller():
    raw = checked(CONTROLLER_ARCHIVE, 196139, CONTROLLER_SHA256)
    files, seen, total = [], set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as carrier:
        for member in carrier:
            name = member.name.rstrip("/") if member.isdir() else member.name
            relative = relative_path(name)
            if relative.parts[0] not in {"host", "source-manifest.json", "carrier-manifest.json"}:
                raise RuntimeError("unexpected controller member")
            if name in seen:
                raise RuntimeError("duplicate controller member")
            seen.add(name)
            target = ROOT / "controller" / str(relative)
            if member.isdir():
                private_directory(target)
                continue
            if not member.isfile() or member.size > 2 * 1024 * 1024:
                raise RuntimeError("controller requires ordinary bounded files")
            total += member.size
            if total > 16 * 1024 * 1024:
                raise RuntimeError("controller exceeds original source size")
            stream = carrier.extractfile(member)
            if stream is None:
                raise RuntimeError("controller member missing")
            with stream:
                body = stream.read(member.size + 1)
            if len(body) != member.size:
                raise RuntimeError("controller member size mismatch")
            publish(target, body)
            files.append({"path": str(relative), "bytes": len(body),
                          "sha256": hashlib.sha256(body).hexdigest()})
    manifest = read_regular(ROOT / "controller/source-manifest.json", 1024 * 1024)
    if hashlib.sha256(manifest).hexdigest() != CONTROLLER_MANIFEST_SHA256 or len(files) != 39:
        raise RuntimeError("accepted original controller closure differs")
    return files



def install_source():
    raw = checked(ROOT / "inbox" / SOURCE_ARCHIVE, SOURCE_BYTES, SOURCE_SHA256)
    with zipfile.ZipFile(io.BytesIO(raw)) as carrier:
        members = carrier.infolist()
        names = [member.filename for member in members]
        if len(names) != 309 or len(names) != len(set(names)):
            raise RuntimeError("complete source member selection differs")
        manifest = json.loads(carrier.read("source-manifest.json"))
        if (manifest.get("schema") != "scf.ndjson-file-jobs-native-source.v1"
                or manifest.get("operationId") != NATIVE_OPERATION):
            raise RuntimeError("original source operation differs")
        groups = manifest.get("groups", [])
        if [(g.get("name"), g.get("commit"), len(g.get("files", []))) for g in groups] != [
                ("product", PRODUCT_COMMIT, 287), ("publisher", PUBLISHER_COMMIT, 21)]:
            raise RuntimeError("original independent source commits differ")
        selected = {}
        for group in groups:
            if group.get("repository") != REPOSITORY:
                raise RuntimeError("original source repository differs")
            for entry in group["files"]:
                name = entry["archivePath"]
                if name != group["name"] + "/" + str(relative_path(entry["path"])) or name in selected:
                    raise RuntimeError("source member path or uniqueness differs")
                selected[name] = entry
        if set(names) != set(selected) | {"source-manifest.json"}:
            raise RuntimeError("complete source members differ from manifest")
        for member in members:
            relative = relative_path(member.filename)
            mode = member.external_attr >> 16
            if member.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise RuntimeError("source archive requires regular files")
            if member.file_size > 1024 * 1024:
                raise RuntimeError("source member exceeds original maximum")
            body = carrier.read(member)
            entry = selected.get(member.filename)
            if entry:
                git_blob = hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()
                if (len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]
                        or git_blob != entry["gitBlob"]):
                    raise RuntimeError("received original source differs: " + member.filename)
            publish(ROOT / "project" / str(relative), body)
    return manifest


def prepare(shared_state_root):
    if sys.version_info < (3, 11) or not shutil.which("flock"):
        raise RuntimeError("original Python 3.11+ and flock runtime are required")
    shared = Path(shared_state_root).resolve(strict=True)
    for path in (shared, shared / "capacity/memory", shared / "capacity/disk"):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
            raise RuntimeError("existing worker shared admission root is unavailable")
    for name in ("", "inbox", "controller", "project", "control",
                 "control/records", "control/worker", "control/tmp"):
        private_directory(ROOT / name)
    controller_files = install_controller()
    manifest = install_source()
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("existing Node and npm runtime are required")
    version = subprocess.check_output([node, "--version"], text=True, timeout=10).strip()
    if int(version.lstrip("v").split(".")[0]) < 22:
        raise RuntimeError("original merchant requires Node 22 or newer")
    receipt = {
        "schema": "scf.ndjson-file-jobs-equipped-inputs.v1",
        "operationId": NATIVE_OPERATION, "root": str(ROOT), "sharedStateRoot": str(shared),
        "controller": {"archiveSha256": CONTROLLER_SHA256,
                       "manifestSha256": CONTROLLER_MANIFEST_SHA256, "files": controller_files},
        "sourceArchive": {"filename": SOURCE_ARCHIVE, "bytes": SOURCE_BYTES, "sha256": SOURCE_SHA256},
        "source": manifest,
        "runtime": {"node": str(Path(node).resolve()), "nodeVersion": version,
                    "npm": str(Path(npm).resolve()), "python": str(Path(sys.executable).resolve())},
        "budget": {"memoryMiB": 512, "memoryReserveMiB": 128,
                   "diskMiB": 96, "diskReserveMiB": 64, "inodes": 8192, "inodeReserve": 128}
    }
    encoded = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode("utf-8")
    publish(ROOT / "prepared-inputs.json", encoded)
    disk = os.statvfs(ROOT)
    memory = {}
    for name in ("memory.max", "memory.current"):
        path = Path("/sys/fs/cgroup") / name
        if path.is_file():
            memory[name] = path.read_text().strip()
    print(json.dumps({"operationId": NATIVE_OPERATION, "sourceFiles": 308,
                      "receiptSha256": hashlib.sha256(encoded).hexdigest(),
                      "runtime": receipt["runtime"], "memory": memory,
                      "diskAvailableBytes": disk.f_bavail * disk.f_frsize}), flush=True)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shared-state-root", required=True)
    prepare(parser.parse_args().shared_state_root)
