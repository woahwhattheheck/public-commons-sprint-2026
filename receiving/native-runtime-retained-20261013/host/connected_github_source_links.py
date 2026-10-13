#!/usr/bin/env python3
"""Publish a selected immutable source tree without duplicating available blobs."""
from __future__ import annotations

from contextlib import contextmanager
import errno
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile

if __package__:
    from . import connected_github_source as source
else:
    import connected_github_source as source


def _identity(path, name):
    try:
        path = Path(path).expanduser().resolve(strict=True)
    except RuntimeError as exc:
        raise OSError(errno.ELOOP, os.strerror(errno.ELOOP)) from exc
    with source._open_regular_file(path) as stream:
        before = os.fstat(stream.fileno())
        digest = hashlib.sha1(b"blob " + str(before.st_size).encode("ascii") + b"\0")
        remaining = before.st_size
        while remaining:
            chunk = stream.read(min(source.CHUNK, remaining))
            if not chunk:
                raise source.SourceImportError("SOURCE_BLOB_MISMATCH", "Source changed during reading.", name)
            remaining -= len(chunk)
            digest.update(chunk)
        if stream.read(1):
            raise source.SourceImportError("SOURCE_BLOB_MISMATCH", "Source changed during reading.", name)
        after = os.fstat(stream.fileno())
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_mode")
    current = path.stat()
    if any(getattr(before, key) != getattr(after, key) or getattr(after, key) != getattr(current, key)
           for key in fields):
        raise source.SourceImportError("SOURCE_BLOB_MISMATCH", "Source changed during reading.", name)
    return {"source_file": str(path), "blob_sha": digest.hexdigest(), "bytes": after.st_size,
            "device": after.st_dev, "inode": after.st_ino, "mtime_ns": after.st_mtime_ns,
            "permissions": stat.S_IMODE(after.st_mode)}


def _describe(spec):
    if spec["source_file"] is not None:
        observed = _identity(spec["source_file"], spec["path"])
        source._validate_source(spec, observed["blob_sha"], observed["bytes"])
        return observed
    # Encoded strings are immutable source snapshots already retained by the
    # caller. Count and hash in small blocks instead of making another disk copy.
    size = sum(len(chunk) for chunk in source._source_chunks(spec))
    digest = hashlib.sha1(b"blob " + str(size).encode("ascii") + b"\0")
    for chunk in source._source_chunks(spec):
        digest.update(chunk)
    source._validate_source(spec, digest.hexdigest(), size)
    return {"blob_sha": digest.hexdigest(), "bytes": size}


def _destination(root, item):
    destination = root.joinpath(*PurePosixPath(item["path"]).parts)
    current = root
    for part in PurePosixPath(item["path"]).parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise source.SourceImportError("DESTINATION_CONFLICT",
                                           "A parent path is not an ordinary directory.", item["path"])
    if destination.exists() or destination.is_symlink():
        try:
            observed = _identity(destination, item["path"])
        except (OSError, RuntimeError):
            raise source.SourceImportError("DESTINATION_CONFLICT",
                                           "An existing destination is preserved.", item["path"]) from None
        if observed["blob_sha"] != item["blob_sha"] or observed["bytes"] != item["bytes"]:
            raise source.SourceImportError("DESTINATION_CONFLICT",
                                           "An existing destination differs and is preserved.", item["path"])
        if item["mode"] is not None and observed["permissions"] != int(item["mode"][-3:], 8):
            raise source.SourceImportError("DESTINATION_CONFLICT",
                                           "Existing file permissions differ and are preserved.", item["path"])
    return destination


def _source_current(item):
    observed = _identity(item["source_file"], item["path"])
    if observed["blob_sha"] != item["blob_sha"] or observed["bytes"] != item["bytes"]:
        raise source.SourceImportError("SOURCE_BLOB_MISMATCH",
                                       "The selected immutable source changed.", item["path"])
    return observed


def _same_inode(path, identity):
    try:
        observed = path.lstat()
        return observed.st_dev == identity["device"] and observed.st_ino == identity["inode"]
    except OSError:
        return False



def _check_selected(item, observed):
    if (observed["blob_sha"] != item["blob_sha"] or observed["bytes"] != item["bytes"]
            or observed["permissions"] != int((item["mode"] or "100644")[-3:], 8)):
        raise source.SourceImportError("SOURCE_BLOB_MISMATCH",
                                       "The selected source contents or permissions changed before publication.",
                                       item["path"])


@contextmanager
def _staged_hardlink(parent, item, observed):
    # This private name is verified before it can become a public destination.
    # Final-name replacements are never adopted as our staging inode.
    with tempfile.TemporaryDirectory(prefix=".github-source-alias-", dir=parent) as temporary:
        staged = Path(temporary) / "source"
        os.link(observed["source_file"], staged)
        identity = _identity(staged, item["path"])
        _check_selected(item, identity)
        yield staged, identity


def _copy(item, destination, root):
    descriptor, staging = tempfile.mkstemp(prefix=".github-source-", dir=destination.parent)
    try:
        digest = hashlib.sha1(b"blob " + str(item["bytes"]).encode("ascii") + b"\0")
        size = 0
        with os.fdopen(descriptor, "wb") as stream:
            for chunk in source._source_chunks(item["spec"]):
                stream.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            source._validate_source(item["spec"], digest.hexdigest(), size)
            if size != item["bytes"]:
                raise source.SourceImportError("SOURCE_SIZE_MISMATCH", "Source changed before publication.", item["path"])
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), int((item["mode"] or "100644")[-3:], 8))
        try:
            os.link(staging, destination)
            return "written", "copy", size
        except FileExistsError:
            _destination(root, item)
            return "unchanged", "symlink" if destination.is_symlink() else "existing", 0
    finally:
        Path(staging).unlink(missing_ok=True)


def _link(item, destination, root, observed):
    with _staged_hardlink(destination.parent, item, observed) as (staged, identity):
        try:
            os.link(staged, destination, follow_symlinks=False)
        except FileExistsError:
            _destination(root, item)
            return "unchanged", "symlink" if destination.is_symlink() else "existing", 0
        # An atomic editor may replace the final name at any point. Readback
        # reports that conflict while preserving the current final entry.
        _destination(root, item)
    return "written", "hardlink", 0


def _anchor(item, observed, anchors, receipts, parent):
    candidates = [Path(observed["source_file"])]
    name = ".source-" + item["blob_sha"] + "-" + format(observed["permissions"], "o")
    def length(path):
        return min(len(os.fsencode(str(path))), len(os.fsencode(os.path.relpath(path, parent))))
    for directory in sorted(anchors, key=lambda path: length(path / name)):
        # A path prefix does not identify the filesystem in these cloud hosts.
        try:
            if directory.stat().st_dev != observed["device"]:
                continue
        except OSError:
            continue
        target = directory / name
        if length(target) >= length(candidates[0]):
            continue
        if target.exists() or target.is_symlink():
            try:
                existing = _identity(target, item["path"])
            except (OSError, source.SourceImportError):
                continue
            if (existing["blob_sha"] != item["blob_sha"] or existing["bytes"] != item["bytes"]
                    or existing["permissions"] != observed["permissions"]):
                continue
        else:
            try:
                with _staged_hardlink(directory, item, observed) as (staged, identity):
                    created = False
                    try:
                        os.link(staged, target, follow_symlinks=False)
                        created = True
                    except FileExistsError:
                        pass
                    existing = _identity(target, item["path"])
                    _check_selected(item, existing)
                    if created and _same_inode(target, identity):
                        receipts.append({"path": str(target), "blob_sha": item["blob_sha"],
                                         "device": existing["device"], "bytes": item["bytes"]})
            except (OSError, source.SourceImportError):
                # Preserve final names, including a concurrent replacement.
                # Another supplied anchor or the direct source remains usable.
                continue
        candidates.append(target)
        break
    return candidates


def _reference(item, destination, root, observed, anchors, receipts):
    targets = []
    for candidate in _anchor(item, observed, anchors, receipts, destination.parent):
        absolute = str(candidate)
        relative = os.path.relpath(candidate, destination.parent)
        targets.extend([absolute, relative])
    # Short links can fit inside an inode when a long link needs a data page.
    target = min(set(targets), key=lambda value: (len(os.fsencode(value)), value))
    with tempfile.TemporaryDirectory(prefix=".github-source-alias-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "source"
        os.symlink(target, staged)
        # A relative payload is intended for the final parent, not this private
        # staging directory. Validate exactly the target the receiver will use.
        if not staged.is_symlink() or os.readlink(staged) != target:
            raise source.SourceImportError("SOURCE_BLOB_MISMATCH",
                                           "The private source reference changed before publication.", item["path"])
        _check_selected(item, _identity(destination.parent / target, item["path"]))
        try:
            os.link(staged, destination, follow_symlinks=False)
        except FileExistsError:
            _destination(root, item)
            return "unchanged", "symlink" if destination.is_symlink() else "existing", 0
        _destination(root, item)
    return "written", "symlink", 0


def materialize_entries(entries, output_directory, *, link_fallback="copy", link_anchors=()):
    """Validate first, then atomically create selected immutable source aliases."""
    if link_fallback not in ("copy", "symlink"):
        raise source.SourceImportError("SOURCE_LINK_MODE", "link_fallback must be copy or symlink.")
    if not isinstance(link_anchors, (list, tuple)) or any(not isinstance(p, str) or not p for p in link_anchors):
        raise source.SourceImportError("SOURCE_LINK_ANCHOR", "Supply existing link-anchor directories.")
    files, results, receipts = {}, [], []
    operation, source_path = "inspect_destination", None
    try:
        root = source._resolve_output(output_directory)
        if root.exists() and not root.is_dir():
            raise source.SourceImportError("DESTINATION_CONFLICT", "Output must be a directory.")
        anchors = []
        for value in link_anchors:
            directory = Path(value).expanduser().resolve(strict=True)
            if not directory.is_dir():
                raise source.SourceImportError("SOURCE_LINK_ANCHOR", "A link anchor must be an existing directory.")
            if directory not in anchors:
                anchors.append(directory)
        for entry in entries:
            spec = source._source_spec(entry)
            # Retain scalar/string payload fields independently of a caller
            # replacing its surrounding request dictionary.
            spec["payload"] = dict(spec["payload"])
            source_path, operation = spec["path"], "validate_immutable_source"
            observed = _describe(spec)
            item = {key: spec[key] for key in ("path", "blob_sha", "mode", "source_url")}
            item.update(bytes=observed["bytes"], spec=spec)
            if spec["source_file"] is not None:
                item.update(source_file=observed["source_file"])
                item["spec"] = {**spec, "source_file": observed["source_file"]}
            previous = files.get(item["path"])
            if previous is not None:
                if any(previous[key] != item[key] for key in ("blob_sha", "bytes", "mode")):
                    raise source.SourceImportError("SOURCE_DUPLICATE_CONFLICT",
                                                   "Two source entries disagree for the same path.", item["path"])
                continue
            files[item["path"]] = item
        if not files:
            raise source.SourceImportError("SOURCE_MANIFEST", "Input must contain a nonempty files array.")
        for name in files:
            if any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != "."):
                raise source.SourceImportError("SOURCE_PATH_CONFLICT",
                                               "A source file is also another file's parent directory.", name)
        for item in files.values():
            source_path, operation = item["path"], "inspect_destination"
            _destination(root, item)

        for item in files.values():
            source_path, operation = item["path"], "inspect_destination"
            destination = _destination(root, item)
            outcome, method, allocated = "unchanged", "existing", 0
            if destination.exists():
                if destination.is_symlink():
                    method = "symlink"
            else:
                operation = "create_parent"
                destination.parent.mkdir(parents=True, exist_ok=True)
                _destination(root, item)
                observed = _source_current(item) if "source_file" in item else None
                permissions = int((item["mode"] or "100644")[-3:], 8)
                can_share_mode = observed is not None and permissions == observed["permissions"]
                if can_share_mode and observed["device"] == destination.parent.stat().st_dev:
                    operation = "link_immutable_source"
                    try:
                        outcome, method, allocated = _link(item, destination, root, observed)
                    except OSError as exc:
                        fallbacks = {errno.EXDEV, errno.EPERM, errno.EACCES, errno.EMLINK,
                                     getattr(errno, "ENOTSUP", errno.EPERM)}
                        if exc.errno not in fallbacks:
                            raise
                        can_link = False
                    else:
                        can_link = True
                else:
                    can_link = False
                if not can_link:
                    if can_share_mode and link_fallback == "symlink":
                        operation = "reference_immutable_source"
                        outcome, method, allocated = _reference(item, destination, root, observed, anchors, receipts)
                    else:
                        operation = "copy_source"
                        outcome, method, allocated = _copy(item, destination, root)
            result = {key: item[key] for key in ("path", "blob_sha", "bytes")}
            result.update(state=outcome, storage_method=method, data_bytes_written=allocated)
            if item["mode"] is not None:
                result["mode"] = item["mode"]
            if isinstance(item["source_url"], str):
                result["source_url"] = item["source_url"]
            if method == "symlink":
                result["reference"] = os.readlink(destination)
            results.append(result)
    except OSError as exc:
        if isinstance(exc, source.SourceImportIOError):
            exc.completed_files = list(results)
            raise
        raise source.SourceImportIOError(exc, operation=operation, path=source_path,
                                          completed_files=results) from exc
    referenced = sum(row["storage_method"] == "symlink" for row in results)
    return {"ok": True, "output_directory": str(root), "files": results,
            "written": sum(row["state"] == "written" for row in results),
            "unchanged": sum(row["state"] == "unchanged" for row in results),
            "immutable_links": True,
            "hardlinked": sum(row["storage_method"] == "hardlink" for row in results),
            "referenced": referenced,
            "data_bytes_written": sum(row["data_bytes_written"] for row in results),
            "source_files_modified": 0, "link_anchors": receipts,
            "runtime_requirements": {"node_flags": ["--preserve-symlinks", "--preserve-symlinks-main"] if referenced else []}}


def inspect_materialized(manifest, output_directory, *, allow_references=False):
    """Verify the same imported request, including explicitly selected references."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise source.SourceImportError("SOURCE_MANIFEST", "Input must contain a nonempty files array.")
    root, files = source._resolve_output(output_directory), {}
    for entry in manifest["files"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise source.SourceImportError("SOURCE_ENTRY_SHAPE", "Each selected file needs its original path.")
        path = root / entry["path"]
        selected = source._source_spec(entry) if "response" in entry else entry
        spec = source._source_spec({**{key: selected[key] for key in ("path", "blob_sha", "mode")
                                      if key in selected}, "source_file": str(path)})
        if not allow_references and path.is_symlink():
            raise source.SourceImportError("DESTINATION_CONFLICT", "Expected an ordinary imported file.", spec["path"])
        observed = _describe(spec)
        item = {key: spec[key] for key in ("path", "blob_sha", "mode")}
        item["bytes"] = observed["bytes"]
        if entry.get("size") is not None and entry["size"] != item["bytes"]:
            raise source.SourceImportError("SOURCE_SIZE_MISMATCH", "Imported file size changed.", item["path"])
        _destination(root, item)
        previous = files.get(item["path"])
        if previous is not None and any(previous[key] != item[key] for key in ("blob_sha", "mode", "bytes")):
            raise source.SourceImportError("SOURCE_DUPLICATE_CONFLICT", "Selected source paths disagree.", item["path"])
        item["storage_method"] = "symlink" if path.is_symlink() else "ordinary"
        if path.is_symlink():
            item["reference"] = os.readlink(path)
        files[item["path"]] = item
    references = sum(row["storage_method"] == "symlink" for row in files.values())
    return {"ok": True, "output_directory": str(root), "verified": len(files), "files": list(files.values()),
            "referenced": references,
            "runtime_requirements": {"node_flags": ["--preserve-symlinks", "--preserve-symlinks-main"]
                                     if references else []}}
