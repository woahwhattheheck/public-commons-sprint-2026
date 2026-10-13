"""Exact, resumable source copies for the original native placement caller."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import uuid

CHUNK = 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def relative_path(value, *, empty=False):
    if not isinstance(value, str) or "\x00" in value or "\\" in value:
        raise ValueError("Use a plain relative POSIX path")
    if empty and value in ("", "."):
        return "."
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Use a nonempty relative path without dot or parent components")
    return path.as_posix()


def identity(value):
    return {"device": value.st_dev, "inode": value.st_ino, "size": value.st_size,
            "mtime_ns": value.st_mtime_ns, "ctime_ns": value.st_ctime_ns,
            "mode": stat.S_IMODE(value.st_mode), "type": stat.S_IFMT(value.st_mode)}


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.parent / (".placement-json-" + uuid.uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return json.loads(Path(path).read_bytes())
    except FileNotFoundError:
        return None


def _reuse_retained_json(path, raw):
    """Verify and sync an existing immutable record without a temporary copy."""
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) |
                             getattr(os, "O_NONBLOCK", 0))
    except FileNotFoundError:
        return False
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("An immutable placement record must be a regular file")
        if before.st_size != len(raw) or stream.read(len(raw) + 1) != raw:
            raise ValueError("An immutable placement record already has different content")
        os.fsync(stream.fileno())
        after = os.fstat(stream.fileno())
        if identity(before) != identity(after) or identity(path.lstat()) != identity(after):
            raise ValueError("An immutable placement record changed while it was read")
    fsync_directory(path.parent)
    return True


def retain_json(path, value):
    """Publish one immutable JSON identity without overwriting another writer."""
    path = Path(path)
    raw = canonical(value) + b"\n"
    if _reuse_retained_json(path, raw):
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.parent / (".placement-retain-" + uuid.uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not _reuse_retained_json(path, raw):
                raise ValueError("The immutable placement record changed during publication")
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def hash_file(path, expected=None):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("A retained input must be a regular file")
        if expected is not None and identity(before) != expected:
            raise ValueError("A retained source changed: " + str(path))
        digest = hashlib.sha256()
        size = 0
        while True:
            block = stream.read(CHUNK)
            if not block:
                break
            digest.update(block)
            size += len(block)
        after = os.fstat(stream.fileno())
        if identity(before) != identity(after) or size != before.st_size:
            raise ValueError("A source changed while it was read: " + str(path))
        if identity(path.lstat()) != identity(after):
            raise ValueError("A retained source path changed: " + str(path))
        return digest.hexdigest(), size, identity(after)


def inventory(source, *, excludes=()):
    """Read the complete selected tree without following symbolic links."""
    supplied = Path(source).expanduser()
    if not supplied.is_absolute():
        raise ValueError("Source paths must be absolute")
    source = supplied.resolve(strict=True)
    omitted = sorted({relative_path(value) for value in excludes})
    entries = []
    hardlinks = {}
    physical_inodes = set()
    copy_bytes = 0
    allocated_bytes = 0
    stack = [(".", source)]
    while stack:
        relative, path = stack.pop()
        if relative != "." and any(relative == value or relative.startswith(value + "/") for value in omitted):
            continue
        metadata = path.lstat()
        original = identity(metadata)
        row = {"path": relative, "identity": original, "mode": original["mode"]}
        key = (metadata.st_dev, metadata.st_ino)
        if key not in physical_inodes:
            physical_inodes.add(key)
            allocated_bytes += getattr(metadata, "st_blocks", 0) * 512
        if stat.S_ISLNK(metadata.st_mode):
            row.update(kind="symlink", target=os.readlink(path))
            if identity(path.lstat()) != original:
                raise ValueError("A source link changed while it was read: " + str(path))
        elif stat.S_ISDIR(metadata.st_mode):
            row.update(kind="directory")
            children = sorted(path.iterdir(), key=lambda item: item.name, reverse=True)
            stack.extend((child.name if relative == "." else relative + "/" + child.name, child)
                         for child in children)
        elif stat.S_ISREG(metadata.st_mode):
            digest, size, observed = hash_file(path, original)
            row.update(kind="file", size=size, sha256=digest)
            if key in hardlinks:
                row["hardlink_to"] = hardlinks[key]
            else:
                hardlinks[key] = relative
                copy_bytes += size
        else:
            raise ValueError("Source contains a nonportable socket, device or pipe: " + str(path))
        entries.append(row)
    entries.sort(key=lambda item: item["path"])
    # Directory identity changes expose additions/removals during this capture.
    for row in entries:
        path = source if row["path"] == "." else source / row["path"]
        if identity(path.lstat()) != row["identity"]:
            raise ValueError("The source changed during inventory: " + str(path))
    data = {"source": str(source), "requested_source": str(supplied), "excludes": omitted,
            "entries": entries}
    return {**data, "sha256": sha256(canonical(data)), "entries_count": len(entries),
            "copy_bytes": copy_bytes, "allocated_bytes": allocated_bytes,
            "files": sum(row["kind"] == "file" for row in entries),
            "directories": sum(row["kind"] == "directory" for row in entries),
            "symbolic_links": sum(row["kind"] == "symlink" for row in entries)}


def assert_inventory(value, *, content=True):
    source = Path(value["source"])
    if content:
        fresh = inventory(source, excludes=value["excludes"])
        if fresh["sha256"] != value["sha256"]:
            raise ValueError("The selected source changed; prepare a new placement identity")
        return fresh
    for row in value["entries"]:
        path = source if row["path"] == "." else source / row["path"]
        if identity(path.lstat()) != row["identity"]:
            raise ValueError("The selected source changed: " + str(path))
    return value


def contained(path, root):
    path = Path(path)
    root = Path(root).resolve(strict=True)
    current = path
    while not current.exists() and current != current.parent:
        current = current.parent
    if not current.resolve(strict=True).is_relative_to(root):
        raise ValueError("A placement output path resolves outside its selected directory")
    return path


def _same_destination(path, row):
    try:
        observed = path.lstat()
    except FileNotFoundError:
        return False
    if row["kind"] == "directory":
        return stat.S_ISDIR(observed.st_mode) and not stat.S_ISLNK(observed.st_mode)
    if row["kind"] == "symlink":
        return stat.S_ISLNK(observed.st_mode) and os.readlink(path) == row["target"]
    if not stat.S_ISREG(observed.st_mode):
        return False
    digest, size, _ = hash_file(path)
    return size == row["size"] and digest == row["sha256"]


def _copy_file(source, destination, row, staging, root):
    contained(destination.parent, root)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() or destination.is_symlink():
        if not _same_destination(destination, row):
            raise ValueError("A copied destination differs from its retained source: " + str(destination))
        return
    key = sha256(str(destination.relative_to(root)).encode("utf-8"))
    partial = staging / (key + ".partial")
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(source_fd, "rb") as incoming:
        if identity(os.fstat(incoming.fileno())) != row["identity"]:
            raise ValueError("The source changed before copying: " + str(source))
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        output_fd = os.open(partial, flags, 0o600)
        with os.fdopen(output_fd, "r+b", buffering=0) as outgoing:
            initial = os.fstat(outgoing.fileno())
            if not stat.S_ISREG(initial.st_mode) or initial.st_size > row["size"]:
                raise ValueError("Retain the incomplete copy for inspection: " + str(partial))
            remaining = initial.st_size
            digest = hashlib.sha256()
            # Resume only a prefix that actually matches this original source.
            while remaining:
                size = min(CHUNK, remaining)
                old, original = outgoing.read(size), incoming.read(size)
                if old != original or len(old) != size:
                    raise ValueError("The retained partial source copy differs: " + str(partial))
                digest.update(original)
                remaining -= size
            while True:
                block = incoming.read(CHUNK)
                if not block:
                    break
                digest.update(block)
                view = memoryview(block)
                while view:
                    written = outgoing.write(view)
                    if not written:
                        raise OSError("The source copy made no progress")
                    view = view[written:]
            if (outgoing.tell() != row["size"] or digest.hexdigest() != row["sha256"]
                    or identity(os.fstat(incoming.fileno())) != row["identity"]):
                raise ValueError("The source changed during copy: " + str(source))
            os.fchmod(outgoing.fileno(), row["mode"])
            os.fsync(outgoing.fileno())
        os.utime(partial, ns=(row["identity"]["mtime_ns"], row["identity"]["mtime_ns"]),
                 follow_symlinks=False)
        try:
            os.link(partial, destination)
        except FileExistsError:
            if not _same_destination(destination, row):
                raise ValueError("Another destination appeared during source copy")
        fsync_directory(destination.parent)
        partial.unlink()
        fsync_directory(staging)


def copy_inventory(value, destination, *, workspace_root, staging, progress=None):
    """Copy or resume exact original files; never overwrite an existing mismatch."""
    source, destination = Path(value["source"]), Path(destination)
    root, staging = Path(workspace_root).resolve(strict=True), Path(staging)
    contained(destination, root)
    contained(staging, root)
    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
    assert_inventory(value, content=False)
    rows = sorted(value["entries"], key=lambda row: (row["path"].count("/"), row["path"]))
    completed = 0
    for row in rows:
        incoming = source if row["path"] == "." else source / row["path"]
        target = destination if row["path"] == "." else destination / row["path"]
        contained(target.parent, root)
        if row["kind"] == "directory":
            if target.is_symlink() or (target.exists() and not target.is_dir()):
                raise ValueError("A source directory collides with a different destination")
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        elif row["kind"] == "symlink":
            if target.exists() or target.is_symlink():
                if not _same_destination(target, row):
                    raise ValueError("A source link collides with a different destination")
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                os.symlink(row["target"], target)
                fsync_directory(target.parent)
        elif row.get("hardlink_to") is not None:
            first = destination if row["hardlink_to"] == "." else destination / row["hardlink_to"]
            # Sorted traversal may encounter a linked name before its source.
            first_row = next(item for item in rows if item["path"] == row["hardlink_to"])
            first_source = source if first_row["path"] == "." else source / first_row["path"]
            _copy_file(first_source, first, first_row, staging, root)
            if target.exists() or target.is_symlink():
                if not _same_destination(target, row):
                    raise ValueError("A copied hardlink has different content")
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                os.link(first, target)
                fsync_directory(target.parent)
        else:
            _copy_file(incoming, target, row, staging, root)
        completed += 1
        if progress is not None:
            progress({"entries_complete": completed, "entries_total": len(rows),
                      "last_path": row["path"]})
    # Capture the actual original directory union again, detecting added files.
    assert_inventory(value)
    verify_copy(value, destination)
    for row in sorted(rows, key=lambda item: item["path"].count("/"), reverse=True):
        target = destination if row["path"] == "." else destination / row["path"]
        if row["kind"] != "symlink":
            os.chmod(target, row["mode"], follow_symlinks=False)
            os.utime(target, ns=(row["identity"]["mtime_ns"], row["identity"]["mtime_ns"]),
                     follow_symlinks=False)
    fsync_directory(destination if destination.is_dir() else destination.parent)
    return {"source_sha256": value["sha256"], "destination": str(destination),
            "entries": len(rows), "copy_bytes": value["copy_bytes"]}


def verify_copy(value, destination):
    destination = Path(destination)
    expected = {row["path"] for row in value["entries"]}
    observed = set()
    pending = [(".", destination)]
    while pending:
        relative, path = pending.pop()
        if relative != "." and any(relative == item or relative.startswith(item + "/")
                                   for item in value["excludes"]):
            continue
        observed.add(relative)
        metadata = path.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            pending.extend((child.name if relative == "." else relative + "/" + child.name, child)
                           for child in path.iterdir())
    if observed != expected:
        raise ValueError("Retained source copy has a different directory inventory")
    for row in value["entries"]:
        target = destination if row["path"] == "." else destination / row["path"]
        if not _same_destination(target, row):
            raise ValueError("Retained source copy is incomplete or changed: " + str(target))
    return True

