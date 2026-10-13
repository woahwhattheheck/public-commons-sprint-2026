"""Reuse completed files as independently owned, verified operation outputs."""
from __future__ import annotations
import errno
import fcntl
import hashlib
import os
from pathlib import Path
import tempfile
from .common import canonical, describe_file, file_digest, relative_file, verify_file

FICLONE = 0x40049409


def destination_file(root, relative):
    root = Path(root).resolve()
    member = Path(relative)
    if (not isinstance(relative, str) or not member.parts or member.is_absolute()
            or ".." in member.parts or "\\" in relative or "\0" in relative
            or member.as_posix() != relative):
        raise ValueError("Retained reuse requires a portable relative file name")
    target = root / member
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError("Retained reuse destination escapes its operation")
    current = root
    for part in member.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Retained reuse destination contains a file alias")
    return target


def _transfer_count(transfer, method, size):
    if transfer is not None:
        transfer["files"] = transfer.get("files", 0) + 1
        transfer["bytes"] = transfer.get("bytes", 0) + size
        methods = transfer.setdefault("methods", {})
        methods[method] = methods.get(method, 0) + 1


def copy_verified(source_root, descriptor, destination_root, *, path=None, transfer=None,
                  replace_mismatch=False):
    """Retain a verified reflink or independent copy, with atomic publication."""
    relative = descriptor["path"] if path is None else path
    target = destination_file(destination_root, relative)
    expected = {**descriptor, "path": relative}
    source = None
    if target.exists():
        try:
            source = verify_file(destination_root, expected)
        except ValueError:
            if not replace_mismatch:
                raise
            # Only the caller's unfinished stage may replace an interrupted
            # transfer. Its next complete original is checked before replacement.
        if source is not None and source.stat().st_nlink == 1:
            _transfer_count(transfer, "retained", descriptor["bytes"])
            return expected
        # A previously received shared inode becomes independently owned here.
    if source is None:
        source = relative_file(source_root, descriptor["path"])
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with source.open("rb") as src, tempfile.NamedTemporaryFile(
                dir=target.parent, prefix=".write-", delete=False) as out:
            pending = Path(out.name)
            if os.fstat(src.fileno()).st_size != descriptor["bytes"]:
                raise ValueError("Original retained file length changed during reuse")
            method = "reflink"
            try:
                fcntl.ioctl(out.fileno(), FICLONE, src.fileno())
            except OSError as exc:
                if exc.errno not in (errno.EOPNOTSUPP, errno.ENOTTY, errno.EXDEV,
                                     errno.EINVAL, errno.ENOSYS, errno.EPERM):
                    raise
                method = "copy"
                src.seek(0)
                out.seek(0)
                out.truncate()
                fingerprint = hashlib.sha256()
                for block in iter(lambda: src.read(1024 * 1024), b""):
                    out.write(block)
                    fingerprint.update(block)
            out.flush()
            os.fsync(out.fileno())
        actual = file_digest(pending) if method == "reflink" else fingerprint.hexdigest()
        if pending.stat().st_size != descriptor["bytes"] or actual != descriptor["sha256"]:
            raise ValueError("Original retained file changed during reuse")
        os.replace(pending, target)
        pending = None
        fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        _transfer_count(transfer, method, descriptor["bytes"])
        return expected
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def dataset_companions(path):
    """Dataset bodies that GDAL may read beside the selected native file."""
    path = Path(path)
    suffix = path.suffix.lower()
    candidates = []
    if suffix == ".shp":
        candidates.extend(path.parent.glob(path.stem + ".*"))
    elif suffix in (".tif", ".tiff"):
        candidates.extend(Path(str(path) + tail) for tail in (".aux.xml", ".msk", ".ovr"))
        candidates.extend(path.with_suffix(tail) for tail in
                          (".tfw", path.suffix + "w", ".wld"))
    elif suffix == ".csv":
        candidates.append(path.with_suffix(".csvt"))
    elif suffix == ".gpkg":
        candidates.extend(Path(str(path) + tail) for tail in ("-wal", "-shm"))
    return sorted({item for item in candidates if item != path and item.is_file()},
                  key=lambda item: item.name)


def native_companions(directory, files):
    """Preserve the actual native dataset companions at stage completion."""
    result = {}
    claimed = {item["path"] for item in files.values()}
    for item in files.values():
        path = relative_file(directory, item["path"])
        for companion in dataset_companions(path):
            descriptor = describe_file(directory, companion)
            if descriptor["path"] not in claimed:
                result[descriptor["path"]] = descriptor
    return [result[name] for name in sorted(result)]


def registry_snapshot(directory, model, registry):
    """Keep each original registry identifier and its materialized path kind."""
    if not isinstance(registry, dict):
        raise ValueError("Native engine did not return its original output registry")
    directory = Path(directory).resolve()
    files, outputs, directories = {}, {}, []
    for output_id, value in registry.items():
        if not isinstance(output_id, str):
            raise ValueError("Native registry identifiers must be text")
        if isinstance(value, (str, Path)):
            path = Path(value)
            if not path.is_absolute():
                path = directory / model / path
            resolved = path.resolve()
            if not resolved.is_relative_to(directory):
                raise ValueError("Native registry output is outside its retained run")
            relative = resolved.relative_to(directory).as_posix()
            if path.is_file():
                item = describe_file(directory, path)
                files[output_id] = item
                outputs[output_id] = {"kind": "file", "path": relative}
            elif path.is_dir():
                outputs[output_id] = {"kind": "directory", "path": relative}
                directories.append(path)
            else:
                outputs[output_id] = {"kind": "unmaterialized", "path": relative}
        else:
            canonical(value)
            outputs[output_id] = {"kind": "value", "value": value}
    # A returned directory is itself a registry output. Retain its materialized
    # children even when the native registry did not assign each child an ID.
    by_path = {item["path"]: item for item in files.values()}
    additional = {}
    for folder in directories:
        members, empty_directories = [], []
        for path in sorted(folder.rglob("*")):
            relative = path.resolve().relative_to(directory).as_posix()
            if path.is_file():
                if relative not in by_path:
                    by_path[relative] = describe_file(directory, path)
                    additional[relative] = by_path[relative]
                members.append(relative)
            elif path.is_dir():
                empty_directories.append(relative)
        relative = folder.resolve().relative_to(directory).as_posix()
        for item in outputs.values():
            if item.get("kind") == "directory" and item["path"] == relative:
                item["members"] = members
                item["directories"] = empty_directories
    return files, outputs, [additional[name] for name in sorted(additional)]


def verify_stage(directory, stage, *, outputs=True):
    if not isinstance(stage, dict) or not stage.get("completed_at"):
        raise ValueError("Retain the completed original native stage")
    if not isinstance(stage.get("files"), dict):
        raise ValueError("Retain the original native output registry")
    verify_file(directory, stage["arguments"])
    if outputs:
        for item in stage["files"].values():
            verify_file(directory, item)
        for item in stage.get("companions", []) + stage.get("additional_files", []):
            verify_file(directory, item)
    if stage.get("requested_arguments"):
        verify_file(directory, stage["requested_arguments"])
    return stage
