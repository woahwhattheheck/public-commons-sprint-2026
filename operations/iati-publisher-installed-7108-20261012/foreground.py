#!/usr/bin/env python3
"""Run the two original installed IATI receiving inputs in one native foreground."""
from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import termios
import time
import threading
import uuid

SCHEMA = "commons.iati-native-foreground/v1"
INTAKE = "commons.iati-native-source-intake/v1"
STAMP = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
MAX_INTAKE = 32 * 1024 * 1024


def need(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def directory(path):
    path = Path(path)
    need(path.is_absolute() and str(path) == str(path.absolute()), "Use an absolute private path")
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
         path.resolve() == path and info.st_uid == os.getuid() and not (info.st_mode & 0o077),
         "The selected directory must remain private and canonical: " + str(path))
    return path


@contextlib.contextmanager
def lease(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info, named = os.fstat(fd), Path(path).lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
             and not (info.st_mode & 0o077) and
             (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino), "The original lock changed")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def file_identity(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode), "Expected a regular file: " + str(path))
        digest, size = hashlib.sha256(), 0
        with os.fdopen(fd, "rb", closefd=False) as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
                size += len(block)
        after, named = os.fstat(fd), path.lstat()
        need(size == before.st_size and (before.st_dev, before.st_ino) == (named.st_dev, named.st_ino)
             and all(getattr(before, key) == getattr(after, key) for key in STAMP),
             "The selected original file changed: " + str(path))
        return {"path": str(path), "bytes": size, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def verify(path, expected):
    value = file_identity(path)
    need(value["bytes"] == expected["bytes"] and value["sha256"] == expected["sha256"],
         "The selected file differs: " + str(path))
    return value


def write_record(path, value, immutable=False):
    path = Path(path)
    data = canonical(value)
    if immutable and path.exists():
        need(path.read_bytes() == data, "The original input differs: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def copy_exact(source, destination, expected):
    source, destination = Path(source), Path(destination)
    directory(destination.parent)
    verify(source, expected)
    stage = destination.with_name("." + destination.name + "." + expected["sha256"] + ".part")
    if destination.exists():
        verified = verify(destination, expected)
        if stage.exists():
            stage_info, destination_info = stage.lstat(), destination.lstat()
            if (stage_info.st_dev, stage_info.st_ino) == (destination_info.st_dev, destination_info.st_ino):
                verify(stage, expected)
                stage.unlink()
                sync_directory(destination.parent)
        need(destination.lstat().st_nlink == 1, "Published copy has additional hard links")
        return verified
    if stage.exists():
        prior = file_identity(stage)
        if prior["bytes"] != expected["bytes"] or prior["sha256"] != expected["sha256"]:
            history = directory(destination.parent / "interrupted-copies")
            stage.rename(history / (destination.name + "." + prior["sha256"] + "." + uuid.uuid4().hex))
            sync_directory(history)
    if not stage.exists():
        read_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        write_fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(read_fd, "rb", closefd=False) as left, os.fdopen(write_fd, "wb", closefd=False) as right:
                shutil.copyfileobj(left, right, 1024 * 1024)
                right.flush()
                os.fsync(write_fd)
        finally:
            os.close(read_fd)
            os.close(write_fd)
    verify(stage, expected)
    verify(source, expected)
    fd = os.open(stage, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(stage, destination, follow_symlinks=False)
    except FileExistsError:
        verify(destination, expected)
    sync_directory(destination.parent)
    stage.unlink()
    sync_directory(destination.parent)
    return verify(destination, expected)



def publish_bytes(destination, data, mode=0o600):
    destination = Path(destination)
    directory(destination.parent)
    expected = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    stage = destination.with_name("." + destination.name + "." + expected["sha256"] + ".part")
    if destination.exists():
        actual = verify(destination, expected)
        if stage.exists():
            a, b = stage.lstat(), destination.lstat()
            if (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino):
                verify(stage, expected)
                stage.unlink()
                sync_directory(destination.parent)
        need(destination.lstat().st_nlink == 1, "Published input has additional hard links")
        return actual
    if stage.exists():
        old = file_identity(stage)
        if old["bytes"] != expected["bytes"] or old["sha256"] != expected["sha256"]:
            history = directory(destination.parent / "interrupted-inputs")
            stage.rename(history / (destination.name + "." + old["sha256"] + "." + uuid.uuid4().hex))
            sync_directory(history)
            sync_directory(destination.parent)
    if not stage.exists():
        fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    verify(stage, expected)
    fd = os.open(stage, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(stage, destination, follow_symlinks=False)
    except FileExistsError:
        verify(destination, expected)
    sync_directory(destination.parent)
    stage.unlink()
    sync_directory(destination.parent)
    need(destination.lstat().st_nlink == 1, "Published input has additional hard links")
    return verify(destination, expected)


def bounded_intake(config):
    expected = config["intake"]
    verify(expected["path"], expected)
    with gzip.open(expected["path"], "rb") as stream:
        raw = stream.read(MAX_INTAKE + 1)
    need(len(raw) <= MAX_INTAKE and hashlib.sha256(raw).hexdigest() == expected["rawSha256"],
         "The complete source intake changed")
    value = json.loads(raw)
    need(value["schema"] == INTAKE and value["operationId"] == config["operationId"] and
         value["sourceCommit"] == config["sourceCommit"], "The original intake selection differs")
    return value


def receive_stdin_intake(config):
    """Receive the original selected gzip in this same private foreground."""
    expected = config["intake"]
    project = directory(config["project"])
    target = Path(expected["path"])
    need(target == project / "intake" / "source-intake.json.gz",
         "Stream the selected original input only into this foreground's private intake")
    directory(target.parent)
    retained = expected["retainedShared"]
    shared_part = Path(retained["path"])
    need(shared_part.is_absolute() and Path(retained["lock"]).is_absolute(),
         "Retain the original shared intake and its existing lock")
    with lease(Path(retained["lock"])):
        prior = file_identity(shared_part) if shared_part.exists() else None
        if prior:
            need(prior["bytes"] <= expected["bytes"], "Original shared prefix exceeds the selected intake")
        original_fd = os.open(shared_part, os.O_RDONLY | os.O_NOFOLLOW) if prior else None
        original_stat = os.fstat(original_fd) if original_fd is not None else None
        stage = target.with_name("." + target.name + "." + expected["sha256"] + ".part")
        terminal = None
        fd = None
        try:
            if target.exists():
                verify(target, expected)
                if stage.exists():
                    a, b = stage.lstat(), target.lstat()
                    if (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino):
                        stage.unlink()
                        sync_directory(target.parent)
            else:
                fd = os.open(stage, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                info = os.fstat(fd)
                need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
                     and not (info.st_mode & 0o077) and info.st_size <= expected["bytes"],
                     "The private retained intake changed")
                if sys.stdin.isatty():
                    terminal = termios.tcgetattr(0)
                    raw = termios.tcgetattr(0)
                    raw[3] &= ~(termios.ECHO | termios.ICANON)
                    raw[6][termios.VMIN], raw[6][termios.VTIME] = 1, 0
                    termios.tcsetattr(0, termios.TCSANOW, raw)
                print(json.dumps({"phase": "PRIVATE_INTAKE_TRANSFER_READY", "operationId": config["operationId"],
                    "bytes": expected["bytes"], "sha256": expected["sha256"],
                    "existingPrivatePrefixBytes": info.st_size, "retainedShared": prior}), flush=True)
                offset, index = 0, 0
                while offset < expected["bytes"]:
                    line = sys.stdin.buffer.readline(40000)
                    need(line.endswith(b"\n"), "The original framed intake ended before a complete chunk")
                    message = json.loads(line)
                    need(isinstance(message, dict) and set(message) == {"index", "offset", "data"} and
                         type(message["index"]) is int and type(message["offset"]) is int and
                         message["index"] == index and message["offset"] == offset,
                         "The original intake frame is out of sequence")
                    chunk = base64.b64decode(message["data"], validate=True)
                    need(0 < len(chunk) <= 24576 and offset + len(chunk) <= expected["bytes"],
                         "The original intake frame exceeds its exact selected bytes")
                    if original_fd is not None:
                        saved = os.pread(original_fd, min(len(chunk), max(0, prior["bytes"] - offset)), offset)
                        need(chunk.startswith(saved), "The original shared intake prefix differs")
                    existing = os.pread(fd, len(chunk), offset)
                    need(chunk.startswith(existing), "The original private intake prefix differs")
                    remaining = memoryview(chunk)[len(existing):]
                    os.lseek(fd, offset + len(existing), os.SEEK_SET)
                    while remaining:
                        count = os.write(fd, remaining)
                        need(count > 0, "The original private intake could not be retained")
                        remaining = remaining[count:]
                    os.fsync(fd)
                    offset += len(chunk)
                    print(json.dumps({"phase": "PRIVATE_INTAKE_CHUNK_RETAINED", "index": index, "bytes": offset}), flush=True)
                    index += 1
                verify(stage, expected)
                os.fsync(fd)
                try:
                    os.link(stage, target, follow_symlinks=False)
                except FileExistsError:
                    verify(target, expected)
                sync_directory(target.parent)
                stage.unlink()
                sync_directory(target.parent)
            actual = verify(target, expected)
            need(target.lstat().st_nlink == 1, "The complete private intake has additional hard links")
            if prior:
                with target.open("rb") as complete:
                    digest = hashlib.sha256()
                    remaining = prior["bytes"]
                    while remaining:
                        block = complete.read(min(65536, remaining))
                        need(block, "The complete intake is shorter than its original shared prefix")
                        digest.update(block)
                        remaining -= len(block)
                need(digest.hexdigest() == prior["sha256"], "The complete input differs from the retained shared prefix")
                after = os.fstat(original_fd)
                need(all(getattr(original_stat, key) == getattr(after, key) for key in STAMP)
                     and file_identity(shared_part) == prior, "The original shared intake changed during receiving")
            bounded_intake(config)
            receipt = {"schema": "commons.iati-stdin-intake/v1", "operationId": config["operationId"],
                       "sourceCommit": config["sourceCommit"], "intake": actual,
                       "retainedShared": prior, "sharedPrefixVerifiedBytes": prior["bytes"] if prior else 0,
                       "sharedOriginalPreserved": True, "receivedAt": now()}
            write_record(project / "stdin-intake-receipt.json", receipt, immutable=True)
            print(json.dumps({"phase": "PRIVATE_SOURCE_INPUT_READY", **receipt}), flush=True)
            return receipt
        finally:
            if terminal is not None:
                termios.tcsetattr(0, termios.TCSANOW, terminal)
            if fd is not None:
                os.close(fd)
            if original_fd is not None:
                os.close(original_fd)


def run_checked(argv, **kwargs):
    outcome = subprocess.run(argv, shell=False, **kwargs)
    need(outcome.returncode == 0, "Original command failed: " + argv[0])
    return outcome


def preflight(config):
    paths = config["paths"]
    verify(Path(__file__).resolve(), config["launcher"])
    for helper in config["library"]["helpers"]:
        verify(Path(config["library"]["helperDirectory"]) / helper["name"], helper)
    verify(Path(paths["host"]) / "swarm_cloud_job.py", config["hostCli"])
    need(Path(paths["playwrightModule"]).is_file(), "The selected Playwright module is absent")
    need(Path(paths["chromiumExecutable"]).is_file(), "The selected Chromium executable is absent")
    need(Path(paths["donorRepository"]).is_dir(), "The original source donor is absent")
    observed = {
        "node": run_checked([paths["nodeExecutable"], "--version"], capture_output=True, text=True).stdout.strip(),
        "python": run_checked([paths["pythonExecutable"], "-B", "-c",
            "import sys,pyexpat,json;print(json.dumps({'version':sys.version.split()[0],'expat':'.'.join(map(str,pyexpat.version_info))}))"],
            capture_output=True, text=True).stdout.strip(),
        "chromium": run_checked([paths["chromiumExecutable"], "--version"], capture_output=True, text=True).stdout.strip(),
    }
    need(observed["node"] == config["versions"]["node"], "The selected Node version changed")
    python = json.loads(observed["python"])
    need(python["version"] == config["versions"]["python"] and
         python["expat"] == config["versions"]["expat"], "The selected Python or Expat version changed")
    need(observed["chromium"] == config["versions"]["chromium"], "The selected Chromium version changed")
    return observed


def materialize(config, intake):
    project = directory(config["project"])
    bootstrap = directory(project / "bootstrap")
    incoming = directory(project / "incoming")
    blobs = {row["sha"]: row for row in intake["blobs"]}
    need(len(blobs) == len(intake["blobs"]), "Duplicate original source objects")
    manifest = intake["sourceManifest"]
    need(manifest["sourceCommit"] == config["sourceCommit"] and
         manifest["sourceTree"] == intake["metadata"]["source"]["tree"],
         "Original source manifest and Git metadata differ")
    for row in manifest["files"]:
        relative = Path(row["path"])
        need(not relative.is_absolute() and all(part not in ("", ".", "..") for part in relative.parts),
             "Original source path is invalid")
        source = blobs[row["gitBlob"]]["content"].encode()
        need(len(source) == row["bytes"] and hashlib.sha256(source).hexdigest() == row["sha256"] and
             hashlib.sha1(("blob " + str(len(source)) + "\0").encode() + source).hexdigest() == row["gitBlob"],
             "Original Git source bytes differ: " + str(relative))
        target = bootstrap / relative
        directory(target.parent)
        publish_bytes(target, source, 0o700 if row["mode"] == "100755" else 0o600)
        original = incoming / (row["gitBlob"] + ".blob.gz")
        if original.exists():
            need(gzip.decompress(original.read_bytes()) == source, "Original incoming source changed")
        else:
            publish_bytes(original, gzip.compress(source, mtime=0))
    sync_directory(incoming)
    metadata = project / "bootstrap-source.json.gz"
    body = canonical(intake["metadata"])
    if metadata.exists():
        need(gzip.decompress(metadata.read_bytes()) == body, "Original source metadata changed")
    else:
        publish_bytes(metadata, gzip.compress(body, mtime=0))
    write_record(project / "source-manifest.json", manifest, immutable=True)
    for publisher in intake["publishers"]:
        write_record(project / ("input-" + publisher["id"] + ".json"), publisher["configuration"], immutable=True)
    return bootstrap


def inventory(root, excluded):
    result = []
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        parent = Path(current)
        kept = []
        for name in sorted(directories):
            path = parent / name
            relative = path.relative_to(root).as_posix()
            if any(relative == item or relative.startswith(item + "/") for item in excluded):
                continue
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                result.append({"path": relative, "type": "symlink", "target": os.readlink(path),
                               "mode": stat.S_IMODE(info.st_mode)})
            else:
                need(stat.S_ISDIR(info.st_mode), "Unexpected receiving directory")
                result.append({"path": relative, "type": "directory", "mode": stat.S_IMODE(info.st_mode),
                               "originalDevice": info.st_dev, "originalInode": info.st_ino,
                               "originalNlink": info.st_nlink, "mtimeNs": info.st_mtime_ns})
                kept.append(name)
        directories[:] = kept
        for name in sorted(files):
            path = parent / name
            relative = path.relative_to(root).as_posix()
            if any(relative == item or relative.startswith(item + "/") for item in excluded):
                continue
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                result.append({"path": relative, "type": "symlink", "target": os.readlink(path),
                               "mode": stat.S_IMODE(info.st_mode)})
            else:
                identity = {"path": relative, "mode": stat.S_IMODE(info.st_mode),
                            "originalDevice": info.st_dev, "originalInode": info.st_ino,
                            "originalNlink": info.st_nlink, "mtimeNs": info.st_mtime_ns}
                if stat.S_ISREG(info.st_mode):
                    ident = file_identity(path)
                    result.append({**identity, "type": "file", "bytes": ident["bytes"],
                                   "sha256": ident["sha256"]})
                else:
                    kind = ("socket" if stat.S_ISSOCK(info.st_mode) else
                            "fifo" if stat.S_ISFIFO(info.st_mode) else
                            "character-device" if stat.S_ISCHR(info.st_mode) else
                            "block-device" if stat.S_ISBLK(info.st_mode) else "special")
                    result.append({**identity, "type": kind, "originalRdev": info.st_rdev,
                                   "retention": "original-endpoint-identity"})
    return sorted(result, key=lambda item: item["path"])


def archive_state(root, output, excluded, selection):
    root, output = Path(root), Path(output)
    directory(output.parent)
    rows = inventory(root, excluded)
    manifest = {"schema": "commons.original-receiving-state/v1", "selection": selection,
                "originalRoot": str(root), "files": rows}
    stage = output.with_name("." + output.name + "." + uuid.uuid4().hex + ".part")
    payload = canonical(manifest)
    with tarfile.open(stage, "w:gz", format=tarfile.PAX_FORMAT, compresslevel=6) as archive:
        entry = tarfile.TarInfo("receiving-state-manifest.json")
        entry.size, entry.mode = len(payload), 0o600
        archive.addfile(entry, io.BytesIO(payload))
        for row in rows:
            path = root / row["path"]
            item = tarfile.TarInfo("state/" + row["path"])
            item.mode = row["mode"]
            item.uid = item.gid = 0
            item.uname = item.gname = ""
            item.mtime = row.get("mtimeNs", 0) / 1_000_000_000
            if row["type"] == "file":
                item.type, item.size = tarfile.REGTYPE, row["bytes"]
                verify(path, row)
                with path.open("rb") as stream:
                    archive.addfile(item, stream)
                verify(path, row)
            elif row["type"] == "directory":
                item.type = tarfile.DIRTYPE
                archive.addfile(item)
            elif row["type"] == "symlink":
                item.type, item.linkname = tarfile.SYMTYPE, row["target"]
                archive.addfile(item)
            else:
                endpoint = canonical(row)
                item = tarfile.TarInfo("special-identities/" + row["path"] + ".json")
                item.type, item.size, item.mode = tarfile.REGTYPE, len(endpoint), 0o600
                archive.addfile(item, io.BytesIO(endpoint))
    need(inventory(root, excluded) == rows,
         "The original receiving files changed during state capture")
    with stage.open("rb") as stream:
        os.fsync(stream.fileno())
    expected = {(("state/" + row["path"]) if row["type"] in ("file", "directory", "symlink")
                 else ("special-identities/" + row["path"] + ".json")): row for row in rows}
    with tarfile.open(stage, "r:gz") as archive:
        seen = set()
        for member in archive:
            if member.name == "receiving-state-manifest.json":
                need(archive.extractfile(member).read() == payload, "Receiving state manifest differs")
                continue
            need(member.name in expected and member.name not in seen, "Unexpected receiving archive member")
            seen.add(member.name)
            row = expected[member.name]
            if row["type"] == "file":
                need(member.isfile() and member.size == row["bytes"], "Receiving archive file identity differs")
                digest = hashlib.sha256()
                with archive.extractfile(member) as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(block)
                need(digest.hexdigest() == row["sha256"], "Receiving archive bytes differ")
            elif row["type"] == "directory":
                need(member.isdir(), "Receiving archive directory differs")
            elif row["type"] == "symlink":
                need(member.issym() and member.linkname == row["target"], "Receiving archive link differs")
            else:
                need(member.isfile() and archive.extractfile(member).read() == canonical(row),
                     "The original runtime endpoint identity differs")
        need(seen == set(expected), "Receiving archive is incomplete")
    if output.exists():
        history = directory(output.parent / "prior-state-archives")
        previous = file_identity(output)
        copy_exact(output, history / (output.name + "." + previous["sha256"]), previous)
        output.unlink()
    os.link(stage, output, follow_symlinks=False)
    stage.unlink()
    sync_directory(output.parent)
    return {**file_identity(output), "members": len(rows), "sourceBytes":
            sum(row.get("bytes", 0) for row in rows)}



def library_helpers(config):
    source = Path(config["library"]["helperDirectory"])
    destination = directory(Path(config["project"]) / "library" / "helpers")
    for selected in config["library"]["helpers"]:
        copy_exact(source / selected["name"], destination / selected["name"], selected)
    if str(destination) not in sys.path:
        sys.path.insert(0, str(destination))
    from library_upload import LibraryUploadWorkflow, SignedUrlUploader
    from library_hosted_apps import HostedAppsClient
    from library_file_transfer import LibraryFileMaterializer
    return LibraryUploadWorkflow, SignedUrlUploader, HostedAppsClient, LibraryFileMaterializer



class ObservedLibraryClient:
    """Record the original SDK boundary without replacing or retrying its calls."""
    def __init__(self, client, directory_path):
        self.client = client
        self.directory = directory(directory_path)
        self.counter = 0
        self.lock = threading.Lock()

    def call_tool(self, connector_id, tool_name, arguments):
        with self.lock:
            self.counter += 1
            stem = "%04d" % self.counter
            write_record(self.directory / (stem + "-request.json"), {
                "connector_id": connector_id, "tool_name": tool_name,
                "arguments": arguments, "at": now(),
            }, immutable=True)
        try:
            result = self.client.call_tool(connector_id, tool_name, arguments)
        except BaseException as error:
            write_record(self.directory / (stem + "-exception.json"), {
                "type": type(error).__name__, "message": str(error), "at": now(),
            }, immutable=True)
            raise
        write_record(self.directory / (stem + "-result.json"), result, immutable=True)
        return result


def ordered_upload_result(value, selected):
    need(isinstance(value, dict) and isinstance(value.get("results"), list) and
         len(value["results"]) == len(selected), "The original ordered upload result is incomplete")
    for item, source in zip(value["results"], selected):
        need(item.get("local_path") == source["path"] and item.get("purpose") == "create_library_file",
             "An upload result does not match its original ordered selection")
        need(item.get("status") == "succeeded" and item.get("local_metadata_applied") is True and
             isinstance(item.get("library_file_id"), str) and item["library_file_id"] and
             isinstance(item.get("file_id"), str) and item["file_id"],
             "The original file saving or its metadata still needs reconciliation")
        verify(source["path"], source)
    return value


def preserve_upload_observation(config, parent, selected, state):
    shared = directory(Path(config["sharedReturn"]) / "upload")
    with lease(shared / "observation.lock"):
        for name in ("selection.json", "invocation.json", "result.json", "error.json",
                     "stdout.log", "stderr.log", "resolved-result.json"):
            source = parent / name
            if source.is_file():
                expected = file_identity(source)
                # Each observation is a new exact file; old observations remain available.
                destination = shared / (name + "." + expected["sha256"])
                shared_bound(config, expected["bytes"], destination)
                copy_exact(source, destination, expected)
        calls = parent / "calls"
        if calls.is_dir():
            for source in sorted(calls.iterdir()):
                if source.is_file():
                    expected = file_identity(source)
                    destination = shared / (source.name + "." + expected["sha256"])
                    shared_bound(config, expected["bytes"], destination)
                    copy_exact(source, destination, expected)
        shared_record(config, shared / "status.json", {
            "schema": "commons.original-library-upload-observation/v1",
            "operationId": config["operationId"],
            "selectionSha256": hashlib.sha256(canonical(selected)).hexdigest(),
            "state": state, "originalDirectory": str(parent), "observedAt": now(),
            "files": selected,
        })


def upload_artifacts(config, files):
    selected = [verify(item["path"], item) for item in files]
    parent = directory(Path(config["project"]) / "library" / "upload")
    selection_sha = hashlib.sha256(canonical(selected)).hexdigest()
    write_record(parent / "selection.json", {"files": selected, "sha256": selection_sha}, immutable=True)
    result_path = parent / "result.json"
    completed = parent / "resolved-result.json"
    if completed.is_file():
        return ordered_upload_result(json.loads(completed.read_bytes()), selected)
    LibraryUploadWorkflow, SignedUrlUploader, HostedAppsClient, LibraryFileMaterializer = library_helpers(config)
    if not (parent / "invocation.json").exists():
        write_record(parent / "invocation.json", {
            "operationId": config["operationId"], "selectionSha256": selection_sha,
            "state": "CALLING_ORIGINAL_WORKFLOW", "startedAt": now(),
        }, immutable=True)
        output_path, error_path = parent / "stdout.log", parent / "stderr.log"
        with output_path.open("x", encoding="utf-8") as output, error_path.open("x", encoding="utf-8") as error:
            try:
                workflow = LibraryUploadWorkflow(
                    apps_client=ObservedLibraryClient(HostedAppsClient(), parent / "calls"),
                    materializer=LibraryFileMaterializer(),
                    uploader=SignedUrlUploader(), state_parent=str(directory(parent / "temporary")))
                request = {"uploads": [
                    {"local_path": item["path"], "purpose": "create_library_file", "library_artifact_type": "other"}
                    for item in selected
                ]}
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
                    value = workflow.run(request)
                write_record(result_path, value, immutable=True)
            except BaseException as failure:
                write_record(parent / "error.json", {
                    "type": type(failure).__name__, "message": str(failure),
                    "state": "OUTCOME_REQUIRES_RECONCILIATION", "at": now(),
                }, immutable=True)
            finally:
                for stream in (output, error):
                    stream.flush()
                    os.fsync(stream.fileno())
    if result_path.is_file():
        original = json.loads(result_path.read_bytes())
        try:
            ordered_upload_result(original, selected)
        except (ValueError, OSError):
            pass
        else:
            write_record(completed, original, immutable=True)
            preserve_upload_observation(config, parent, selected, "SUCCEEDED")
            return original
    preserve_upload_observation(config, parent, selected, "RECONCILIATION_REQUIRED")
    resolution = Path(config["sharedReturn"]) / "upload" / "reconciliation.json"
    print(json.dumps({"phase": "ORIGINAL_UPLOAD_RECONCILIATION", "selectionSha256": selection_sha,
                      "originalDirectory": str(parent), "resolution": str(resolution)}), flush=True)
    # Keep the original namespace and every file alive. A second run() would create a
    # new preparation; only observed results of this exact original call are accepted.
    while True:
        if resolution.is_file():
            try:
                supplied = json.loads(resolution.read_bytes())
                need(supplied.get("selectionSha256") == selection_sha and
                     isinstance(supplied.get("evidence"), list) and supplied["evidence"],
                     "The upload reconciliation must identify the exact observed original call")
                value = supplied.get("result")
                need(isinstance(value, dict) and isinstance(value.get("results"), list) and
                     len(value["results"]) == len(selected), "The observed upload result is incomplete")
                for repair in supplied.get("metadataRepairs", []):
                    index = repair.get("index")
                    need(isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(selected),
                         "The metadata repair does not select an original file")
                    item, source = value["results"][index], selected[index]
                    need(item.get("status") == "succeeded" and item.get("local_path") == source["path"] and
                         repair.get("library_file_id") == item.get("library_file_id") and
                         isinstance(repair.get("xattrs"), list),
                         "Repair only metadata for an observed completed original upload")
                    verify(source["path"], source)
                    command = [config["paths"]["pythonExecutable"], "-B",
                               str(Path(config["project"]) / "library" / "helpers" / "library_file_transfer.py"),
                               "apply-xattrs", source["path"], item["library_file_id"]]
                    attempt = repair.get("attempt", 1)
                    need(isinstance(attempt, int) and not isinstance(attempt, bool) and 1 <= attempt <= 1000,
                         "A local metadata repair requires a positive retained attempt number")
                    repair_path = parent / ("metadata-repair-" + str(index) + "-" + str(attempt) + ".json")
                    repair_input = {"command": command, "xattrs": repair["xattrs"]}
                    if repair_path.is_file():
                        applied = json.loads(repair_path.read_bytes())
                        need(applied.get("input") == repair_input,
                             "The original metadata repair selection changed")
                    else:
                        outcome = subprocess.run(command, shell=False, input=json.dumps(repair["xattrs"]),
                                                 capture_output=True, text=True)
                        applied = {"input": repair_input, "exitCode": outcome.returncode,
                                   "stdout": outcome.stdout, "stderr": outcome.stderr,
                                   "evidence": supplied["evidence"]}
                        write_record(repair_path, applied, immutable=True)
                    need(applied["exitCode"] == 0, "The original metadata helper has not completed")
                    item["local_metadata_applied"] = True
                ordered_upload_result(value, selected)
                write_record(parent / "reconciliation.json", supplied, immutable=True)
                write_record(completed, value, immutable=True)
                preserve_upload_observation(config, parent, selected, "RECONCILED")
                return value
            except (ValueError, KeyError, TypeError, OSError) as error:
                # A partial or mismatched observation cannot end the namespace
                # holding the original uncertain save and its complete files.
                print(json.dumps({"phase": "ORIGINAL_UPLOAD_RECONCILIATION",
                                  "observationError": type(error).__name__,
                                  "message": str(error)[:2000],
                                  "namespaceRetained": True}), flush=True)
        time.sleep(15)
        print(json.dumps({"phase": "ORIGINAL_UPLOAD_RECONCILIATION",
                          "selectionSha256": selection_sha, "namespaceRetained": True}), flush=True)


def private_screenshots(project):
    selected = []
    for prefix in ("receiving/operator/views", "receiving-ti/operator/views"):
        root = project / prefix
        if not root.is_dir():
            continue
        for current, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [name for name in dirs if not (Path(current) / name).is_symlink()]
            for name in names:
                path = Path(current) / name
                if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    selected.append({**file_identity(path), "relative": path.relative_to(project).as_posix()})
    return sorted(selected, key=lambda item: item["relative"])


def preserve_visual_qa(config, screenshots):
    selected = [item for item in screenshots
                if Path(item["path"]).name in {
                    "source-1360-portfolios.png", "source-390-portfolios.png",
                    "reopened-1360-portfolios.png", "reopened-390-portfolios.png"}]
    required = {folder + "/" + name for folder in ("receiving/operator/views", "receiving-ti/operator/views")
                for name in ("source-1360-portfolios.png", "source-390-portfolios.png",
                             "reopened-1360-portfolios.png", "reopened-390-portfolios.png")}
    names = {item["relative"] for item in selected}
    if names != required:
        # An interrupted workflow retains the exact views that actually exist.
        need(names <= required, "The private QA selection changed")
    shared = directory(Path(config["sharedReturn"]) / "qa")
    output = []
    for item in selected:
        suffix = "aiddata" if item["relative"].startswith("receiving/") else "transparency-international"
        target = shared / (suffix + "-" + Path(item["path"]).name)
        shared_bound(config, item["bytes"], target)
        output.append(copy_exact(item["path"], target, item))
    return output


def shared_bound(config, additional, destination=None):
    root = Path(config["sharedReturn"])
    size = sum(item["bytes"] for item in inventory(root, set()) if item["type"] == "file")
    if destination is not None:
        destination = Path(destination)
        need(destination.is_relative_to(root), "Keep the original return inside its selected directory")
        if destination.is_file():
            additional = max(0, additional - destination.stat().st_size)
    need(size + additional <= config["resources"]["sharedGrowthMiB"] * 1024 * 1024,
         "The complete shared return exceeds its original declared growth")


def shared_record(config, path, value, immutable=False):
    shared_bound(config, len(canonical(value)), path)
    write_record(path, value, immutable=immutable)


def custody_phase(config, phase, action):
    """Retain this namespace while an original local saving step needs recovery."""
    while True:
        try:
            return action()
        except Exception as error:
            observation = {"phase": phase, "operationId": config["operationId"],
                           "errorType": type(error).__name__, "message": str(error),
                           "observedAt": now(), "namespaceRetained": True}
            try:
                write_record(Path(config["project"]) / "return" / (phase + "-pending.json"), observation)
            except OSError:
                pass
            print(json.dumps({"phase": phase, "operationId": config["operationId"],
                              "errorType": type(error).__name__, "namespaceRetained": True}), flush=True)
            time.sleep(15)


def execute(config):
    project, shared = directory(config["project"]), directory(config["sharedReturn"])
    returned = directory(project / "return")
    started = now()
    state = {"schema": SCHEMA, "operationId": config["operationId"], "sourceCommit": config["sourceCommit"],
             "startedAt": started, "state": "RUNNING", "publishers": []}
    failure = None
    with lease(project / "execution.lock"):
        try:
            library_helpers(config)
            intake = bounded_intake(config)
            bootstrap = materialize(config, intake)
            entry = bootstrap / "stellar/scf-starforge-20261009/sf30-seller-sdk/iati/receiving/complete.mjs"
            for selected in intake["publishers"]:
                ident = selected["id"]
                print(json.dumps({"phase": "ORIGINAL_IATI_RECEIVING", "publisher": ident,
                                  "operationId": selected["configuration"]["operationId"]}), flush=True)
                run_checked([config["paths"]["nodeExecutable"], str(entry),
                             str(project / ("input-" + ident + ".json"))],
                            cwd=project, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
                result_path = Path(selected["configuration"]["outputDirectory"]) / "result.json"
                result = json.loads(result_path.read_bytes())
                need(result["state"] == "COMPLETE" and result["operationId"] == selected["configuration"]["operationId"]
                     and result["sourceCommit"] == config["sourceCommit"], "Original complete result differs")
                customer = result["customerArchive"]
                filename = ident + "-IATI_Customer_Handover.zip"
                copied = copy_exact(customer["path"], returned / filename, customer)
                state["publishers"].append({"id": ident, "result": result,
                                            "customerArchive": copied, "resultFile": file_identity(result_path)})
                write_record(project / "workflow-progress.json", state)
            state["state"] = "COMPLETE"
        except BaseException as error:
            failure = error
            state["state"] = "INTERRUPTED"
            state["error"] = {"type": type(error).__name__, "message": str(error)[:4000]}
        finally:
            state["endedAt"] = now()
            def preserve_receiving():
                if "receivingState" not in state:
                    write_record(project / "workflow-progress.json", state)
                    screenshots = private_screenshots(project)
                    state["privateBrowserScreenshots"] = screenshots
                    write_record(project / "private-browser-qa.json", {"files": screenshots})
                    excluded = {"return", "runtime", "library"} | {item["relative"] for item in screenshots}
                    state["receivingState"] = archive_state(
                        project, returned / "receiving-state.tar.gz", excluded,
                        {"operationId": config["operationId"], "sourceCommit": config["sourceCommit"],
                         "state": state["state"], "privateBrowserScreenshots": screenshots})
                captured = state["receivingState"]
                verify(captured["path"], captured)
                write_record(returned / "customer-result.json", state)
                if "durableFiles" not in state:
                    uploads = [captured] + [row["customerArchive"] for row in state["publishers"]]
                    state["durableFiles"] = upload_artifacts(config, uploads)
                    state["savedAt"] = now()
                with lease(shared / "return.lock"):
                    delivered = []
                    for index, row in enumerate(state["publishers"]):
                        item = row["customerArchive"]
                        if config.get("returnMode", "files") == "durable":
                            saved = state["durableFiles"]["results"][index + 1]
                            need(saved["status"] == "succeeded" and saved["local_path"] == item["path"]
                                 and saved["local_metadata_applied"], "The complete original customer save is not retained")
                            delivered.append({"name": Path(item["path"]).name, "bytes": item["bytes"],
                                "sha256": item["sha256"], "delivery": "durable",
                                "file_id": saved["file_id"], "library_file_id": saved["library_file_id"],
                                **({"current_version_number": saved["current_version_number"]}
                                   if "current_version_number" in saved else {})})
                        else:
                            target = shared / Path(item["path"]).name
                            shared_bound(config, item["bytes"], target)
                            delivered.append(copy_exact(item["path"], target, item))
                    state["sharedCustomerArchives"] = delivered
                    write_record(returned / "customer-result.json", state)
                    copied = file_identity(returned / "customer-result.json")
                    shared_bound(config, copied["bytes"], shared / "customer-result.json")
                    copy_exact(copied["path"], shared / "customer-result.json", copied)
                    shared_record(config, shared / "receiving-return.json", {
                        "schema": SCHEMA, "operationId": config["operationId"], "sourceCommit": config["sourceCommit"],
                        "state": state["state"], "durableFiles": state["durableFiles"],
                        "receivingState": captured, "customerArchives": delivered,
                        "privateCustomerArchives": [row["customerArchive"] for row in state["publishers"]],
                        "privateBrowserScreenshots": state["privateBrowserScreenshots"],
                    })
                return state
            custody_phase(config, "ORIGINAL_RECEIVING_CUSTODY", preserve_receiving)
    if failure:
        raise failure
    return state


def launch(config):
    observed = preflight(config)
    intake = bounded_intake(config)
    project = directory(config["project"])
    shared = directory(config["sharedReturn"])
    with lease(shared / "foreground.lock"):
        if config.get("returnMode", "files") == "files":
            shared_record(config, shared / "launch-selection.json", config, immutable=True)
        write_record(project / "foreground-selection.json", config, immutable=True)
        write_record(project / "preflight.json", {"observedAt": now(), "versions": observed,
            "files": len(intake["sourceManifest"]["files"]),
            "sourceBytes": sum(row["bytes"] for row in intake["sourceManifest"]["files"])})
        directory(project / "return")
        runtime = directory(project / "runtime")
        records, worker, temporary = [directory(runtime / name) for name in ("records", "worker", "temporary")]
        resources, paths = config["resources"], config["paths"]
        argv = [paths["pythonExecutable"], "-B", str(Path(paths["host"]) / "swarm_cloud_job.py"),
            "run", "7108-iati-publisher", "--operation-id", config["operationId"], "--project", str(project),
            "--records-root", str(records), "--worker-root", str(worker), "--temp-root", str(temporary),
            "--memory-mib", str(resources["memoryMiB"]), "--memory-reserve-mib", str(resources["memoryReserveMiB"]),
            "--memory-reclaim", "clean-cache", "--memory-storage", "included",
            "--disk-space", str(project) + "=" + str(resources["privateGrowthMiB"]),
            "--disk-space", str(shared) + "=" + str(resources["sharedGrowthMiB"]),
            "--disk-reserve-mib", str(resources["diskReserveMiB"]),
            "--disk-inodes", str(project) + "=8192", "--disk-inodes", str(shared) + "=1024",
            "--disk-reserve-inodes", "128", "--artifact", "return"]
        for name in ("aiddata-IATI_Customer_Handover.zip", "transparency-international-IATI_Customer_Handover.zip"):
            argv += ["--artifact-on-success", "return/" + name]
        for path in config["runtimePaths"]:
            argv += ["--runtime-path", path]
        argv += ["--", paths["pythonExecutable"], "-B", str(Path(__file__).resolve()),
                 "--execute", config["inputPath"]]
        write_record(project / "native-argv.json", argv, immutable=True)
        native = subprocess.run(argv, shell=False, cwd=project)
        record = records / hashlib.sha256(config["operationId"].encode()).hexdigest()
        result_path = record / "result.json"
        while True:
            try:
                result = json.loads(result_path.read_bytes())
                if result.get("state") in ("completed", "failed", "launch_failed", "finalization_pending"):
                    break
                observation = {"state": result.get("state"), "nativeExitCode": native.returncode}
            except (FileNotFoundError, OSError, ValueError) as error:
                observation = {"state": "TERMINAL_RESULT_PENDING", "nativeExitCode": native.returncode,
                               "error": type(error).__name__}
            # The original controller remains the execution authority. Keep this
            # same namespace alive when its final result has not been observed.
            print(json.dumps({"phase": "ORIGINAL_NATIVE_TERMINAL_PENDING",
                              "operationId": config["operationId"], "record": str(record),
                              "observation": observation, "namespaceRetained": True}), flush=True)
            time.sleep(15)
        retained = {}
        def preserve_native_return():
            if "archive" not in retained:
                retained["archive"] = archive_state(
                    record, project / "return" / "native-record.tar.gz", set(),
                    {"operationId": config["operationId"], "sourceCommit": config["sourceCommit"],
                     "originalRecord": str(record)})
            original = retained["archive"]
            with lease(shared / "return.lock"):
                shared_record(config, shared / "launch-selection.json", config, immutable=True)
                shared_bound(config, original["bytes"], shared / "native-record.tar.gz")
                copied = copy_exact(original["path"], shared / "native-record.tar.gz", original)
                shared_record(config, shared / "native-result.json", result, immutable=True)
                qa = preserve_visual_qa(config, private_screenshots(project))
                files = [file_identity(path) for path in sorted(shared.iterdir())
                         if path.is_file() and path.name not in ("foreground.lock", "return.lock", "result.json")]
                receiving = shared / "receiving-return.json"
                customer_archives = json.loads(receiving.read_bytes())["customerArchives"] if receiving.is_file() else []
                combined = {"schema": SCHEMA, "operationId": config["operationId"],
                            "sourceCommit": config["sourceCommit"],
                            "state": "COMPLETE" if native.returncode == 0 and result.get("state") == "completed" else "INTERRUPTED",
                            "nativeExitCode": native.returncode, "nativeRecord": str(record), "nativeResult": result,
                            "nativeRecordArchive": copied, "customerArchives": customer_archives,
                            "privateVisualQA": qa, "files": files, "endedAt": now()}
                shared_record(config, shared / "result.json", combined)
            print(json.dumps(combined), flush=True)
            return native.returncode
        return custody_phase(config, "ORIGINAL_NATIVE_RETURN", preserve_native_return)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--intake-stdin", action="store_true",
                        help="Receive the exact selected gzip in this same private foreground before admission")
    parser.add_argument("input")
    args = parser.parse_args()
    selected = Path(args.input).resolve(strict=True)
    config = json.loads(selected.read_bytes())
    need(config["schema"] == SCHEMA and config["inputPath"] == str(selected),
         "Select the exact original foreground input")
    need(config.get("returnMode", "files") in ("files", "durable"), "Select the original full-file or durable return")
    need(not (args.execute and args.intake_stdin), "The admitted child consumes the completed original intake")
    if args.intake_stdin:
        receive_stdin_intake(config)
    if args.execute:
        execute(config)
        return 0
    return launch(config)


if __name__ == "__main__":
    raise SystemExit(main())
