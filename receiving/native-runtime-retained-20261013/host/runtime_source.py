"""Retain the local Python source closure used by an original runtime.

This reads source rather than importing it. Public script entrypoints remain
explicit; ordinary and function-local imports carry their local dependencies.
Third-party packages and the command's project inputs keep their own install
and source bindings.
"""
from __future__ import annotations

import argparse
import ast
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile


def relative_path(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value
            or any(part in ("", ".", "..") for part in value.split("/"))):
        raise ValueError("Use an original source path relative to its source root")
    name = PurePosixPath(value)
    if name.is_absolute():
        raise ValueError("Use an original source path relative to its source root")
    return name.as_posix()


def read_source(root, name, *, regular=False):
    """Read one observed version, without following links in a source export."""
    name = relative_path(name)
    path = root / name
    if regular:
        current = root
        for part in PurePosixPath(name).parts:
            current /= part
            if current.is_symlink():
                raise ValueError("Package only original regular source files: " + name)
    flags = os.O_RDONLY | os.O_NONBLOCK
    if regular:
        flags |= os.O_NOFOLLOW
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Expected an original regular source file: " + name)
        remaining, blocks = before.st_size, []
        while remaining:
            block = stream.read(min(remaining, 1024 * 1024))
            if not block:
                raise ValueError("Original source ended during export: " + name)
            blocks.append(block)
            remaining -= len(block)
        if stream.read(1):
            raise ValueError("Original source grew during export: " + name)
        after = os.fstat(stream.fileno())
        identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        if identity(before) != identity(after):
            raise ValueError("Original source changed during export: " + name)
    raw = b"".join(blocks)
    return {"data": raw, "identity": identity(before),
            "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "mode": stat.S_IMODE(before.st_mode), "mtime_ns": before.st_mtime_ns}


def python_sources(root, entrypoints, *, search_paths=(".",), regular=False):
    """Follow the selected scripts' local imports, including lazy imports.

search_paths describes the original script/Python import roots beneath root;
it does not inspect an ambient interpreter's packages or a user's project.
Relative imports cannot escape the selected source root. Required entrypoints
and explicit relative modules must exist before an export is written.
"""
    root = Path(root).resolve(strict=True)
    roots = [PurePosixPath(".") if value == "." else PurePosixPath(relative_path(value))
             for value in search_paths]
    files, pending = {}, [relative_path(value) for value in entrypoints]
    if not pending or any(not name.endswith(".py") for name in pending):
        raise ValueError("Select the original Python entrypoints to retain")

    def local_modules(parts, prefixes):
        found = []
        for prefix in prefixes:
            for length in range(1, len(parts) + 1):
                local = prefix.joinpath(*parts[:length])
                for candidate in (local.with_suffix(".py"), local / "__init__.py"):
                    name = candidate.as_posix()
                    if (root / candidate).is_file() and name not in found:
                        found.append(name)
        return found

    while pending:
        name = pending.pop()
        if name in files:
            continue
        saved = read_source(root, name, regular=regular)
        files[name] = saved
        for node in ast.walk(ast.parse(saved["data"], filename=name)):
            modules, prefixes = [], roots
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    parent = PurePosixPath(name).parent.parts
                    if node.level > len(parent) + 1:
                        raise ValueError("A local runtime import escapes the selected source root")
                    prefix = list(parent[:len(parent) - node.level + 1])
                    base = [*prefix, *node.module.split(".")] if node.module else prefix
                    prefixes = [PurePosixPath(".")]
                    if node.module and regular:
                        target = root.joinpath(*base)
                        if not target.with_suffix(".py").is_file() and not target.is_dir():
                            raise ValueError("Missing local Python module for " + name + ": " + ".".join(base))
                    modules = [".".join(base)]
                    modules += [".".join([*base, alias.name]) for alias in node.names if alias.name != "*"]
                    if not node.module and regular:
                        package = root.joinpath(*prefix)
                        for alias in node.names:
                            if alias.name == "*":
                                continue
                            target = package / alias.name
                            if (not target.with_suffix(".py").is_file() and not target.is_dir()
                                    and not (package / "__init__.py").is_file()):
                                raise ValueError("Missing local Python module for " + name + ": " + alias.name)
                elif node.module:
                    modules = [node.module]
                    modules += [node.module + "." + alias.name for alias in node.names if alias.name != "*"]
            for module in modules:
                if module:
                    pending.extend(candidate for candidate in local_modules(module.split("."), prefixes)
                                   if candidate not in files)
    return files


def package_sources(root, output, *, entrypoints, assets, search_paths=(".",)):
    """Publish a complete private source ZIP, retaining exact selected bytes."""
    root = Path(root).resolve(strict=True)
    output = Path(output).expanduser().absolute()
    entrypoints, assets, search_paths = tuple(entrypoints), tuple(assets), tuple(search_paths)
    files = python_sources(root, entrypoints, search_paths=search_paths, regular=True)
    for name in assets:
        name = relative_path(name)
        if name not in files:
            files[name] = read_source(root, name, regular=True)
    manifest_name = "SOURCE_MANIFEST.json"
    if manifest_name in files:
        raise ValueError("The source selection conflicts with its package manifest")
    if output.resolve() in {root / name for name in files}:
        raise ValueError("Keep the exported archive separate from its original source")
    for name, item in files.items():
        current = (root / name).lstat()
        observed = (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns)
        if observed != item["identity"]:
            raise ValueError("Original source changed while selecting its package: " + name)
    manifest = {"schema": "commons.runtime-source-package/v1", "entrypoints": list(entrypoints),
                "search_paths": list(search_paths),
                "files": [{"path": name, **{key: files[name][key] for key in ("bytes", "sha256", "mode")}}
                          for name in sorted(files)]}
    _manifest_files(manifest)
    raw_manifest = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    pending = None
    try:
        with tempfile.NamedTemporaryFile(mode="w+b", prefix=".runtime-source-", suffix=".zip",
                                         dir=output.parent, delete=False) as stream:
            pending = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, item in sorted(files.items()):
                    stamp = datetime.fromtimestamp(item["mtime_ns"] / 1000000000)
                    year = min(2107, max(1980, stamp.year))
                    info = zipfile.ZipInfo(name, (year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | item["mode"]) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, item["data"])
                info = zipfile.ZipInfo(manifest_name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, raw_manifest)
            stream.flush()
            os.fsync(stream.fileno())
            stream.seek(0)
            checksum = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                checksum.update(block)
            size = os.fstat(stream.fileno()).st_size
            os.link(pending, output)
            directory = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return {"file": str(output), "bytes": size, "sha256": checksum.hexdigest(),
                "files": len(files) + 1, "source_files": len(files),
                "source_manifest": manifest_name,
                "source_manifest_sha256": hashlib.sha256(raw_manifest).hexdigest()}
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


# Source receiving deliberately imports no runtime module. It is usable when
# this one maintained file and the original complete ZIP are all that survived.
PACKAGE_SCHEMA = "commons.runtime-source-package/v1"
RECEIVING_SCHEMA = "commons.runtime-source-receiving/v1"
MANIFEST_NAME = "SOURCE_MANIFEST.json"
RECEIVING_DIRECTORY = ".runtime-source-receiving"
BLOCK = 1024 * 1024


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, stat.S_IMODE(info.st_mode))


def _checksum(value):
    return (isinstance(value, str) and len(value) == 64
            and all(letter in "0123456789abcdef" for letter in value))


def _json_object(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("The source manifest repeats a JSON key: " + key)
            value[key] = item
        return value
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(
                           ValueError("Non-finite source manifest number")))
    if not isinstance(value, dict):
        raise ValueError("The original source manifest must be a JSON object")
    return value


def _manifest_files(manifest):
    if manifest.get("schema") != PACKAGE_SCHEMA:
        raise ValueError("Select an original runtime source package")
    rows = manifest.get("files")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The source package has no complete file inventory")
    files = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid source manifest member")
        name = relative_path(row.get("path"))
        if (name == MANIFEST_NAME or name in files
                or name.split("/")[0] == RECEIVING_DIRECTORY):
            raise ValueError("Repeated or receiving-metadata source path: " + name)
        if (type(row.get("bytes")) is not int or row["bytes"] < 0
                or not _checksum(row.get("sha256"))
                or type(row.get("mode")) is not int
                or not 0 <= row["mode"] <= 0o777):
            raise ValueError("Invalid source byte, digest or mode identity: " + name)
        files[name] = dict(row)
    for name in files:
        if any(parent.as_posix() in files for parent in PurePosixPath(name).parents
               if parent.as_posix() != "."):
            raise ValueError("A selected source file is also a directory: " + name)
    entrypoints = manifest.get("entrypoints")
    roots = manifest.get("search_paths")
    if (not isinstance(entrypoints, list) or not entrypoints
            or not isinstance(roots, list) or not roots):
        raise ValueError("The source package is missing its original entrypoints or import roots")
    for name in entrypoints:
        if relative_path(name) not in files or not name.endswith(".py"):
            raise ValueError("The original Python entrypoint is absent: " + str(name))
    for name in roots:
        if name != ".":
            relative_path(name)
    return files


def _stream_identity(stream):
    info = os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Select an original regular source archive")
    stream.seek(0)
    digest, size = hashlib.sha256(), 0
    remaining = info.st_size
    while remaining:
        block = stream.read(min(BLOCK, remaining))
        if not block:
            raise ValueError("The selected source archive ended during reading")
        digest.update(block)
        size += len(block)
        remaining -= len(block)
    if stream.read(1) or _identity(info) != _identity(os.fstat(stream.fileno())):
        raise ValueError("The selected source archive changed during reading")
    stream.seek(0)
    return info, size, digest.hexdigest()


@contextmanager
def _verified_package(path, expected_sha256=None, *, max_manifest_bytes=16 * BLOCK):
    path = Path(path).expanduser().resolve(strict=True)
    if expected_sha256 is not None and not _checksum(expected_sha256):
        raise ValueError("Supply the complete lowercase SHA256 of the selected archive")
    flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before, size, checksum = _stream_identity(stream)
        if expected_sha256 is not None and checksum != expected_sha256:
            raise ValueError("The source archive differs from its selected SHA256")
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            members = {}
            for info in infos:
                name = relative_path(info.filename)
                kind = stat.S_IFMT(info.external_attr >> 16)
                if (name in members or info.is_dir()
                        or kind not in (0, stat.S_IFREG) or info.flag_bits & 1):
                    raise ValueError("Unsupported or repeated source archive member: " + name)
                members[name] = info
            if MANIFEST_NAME not in members:
                raise ValueError("The complete original source manifest is missing")
            if (type(max_manifest_bytes) is not int or max_manifest_bytes <= 0
                    or members[MANIFEST_NAME].file_size > max_manifest_bytes):
                raise ValueError("The source manifest exceeds the selected reader capacity")
            raw = archive.read(MANIFEST_NAME)
            manifest = _json_object(raw)
            files = _manifest_files(manifest)
            if set(members) != {MANIFEST_NAME, *files}:
                raise ValueError("The source archive member set differs from its original manifest")
            for name, row in files.items():
                info = members[name]
                if (info.file_size != row["bytes"]
                        or stat.S_IMODE(info.external_attr >> 16) != row["mode"]):
                    raise ValueError("The source archive size or mode differs: " + name)
                digest, count = hashlib.sha256(), 0
                with archive.open(info) as source:
                    while block := source.read(BLOCK):
                        digest.update(block)
                        count += len(block)
                        if count > row["bytes"]:
                            raise ValueError("The source member grew beyond its original size: " + name)
                if count != row["bytes"] or digest.hexdigest() != row["sha256"]:
                    raise ValueError("The source member differs from its original bytes: " + name)
            if _identity(before) != _identity(os.fstat(stream.fileno())):
                raise ValueError("The selected source archive changed during verification")
            summary = {"schema": PACKAGE_SCHEMA, "file": str(path),
                       "bytes": size, "sha256": checksum,
                       "source_manifest": MANIFEST_NAME,
                       "source_manifest_sha256": hashlib.sha256(raw).hexdigest(),
                       "source_files": len(files),
                       "source_bytes": sum(row["bytes"] for row in files.values()),
                       "entrypoints": list(manifest["entrypoints"]),
                       "search_paths": list(manifest["search_paths"])}
            def unchanged():
                if (_identity(before) != _identity(os.fstat(stream.fileno()))
                        or _identity(before) != _identity(path.lstat())):
                    raise ValueError("The selected source archive changed before receiving completed")
            yield archive, raw, manifest, files, summary, unchanged
            unchanged()


def inspect_package(path, *, expected_sha256=None):
    """Verify every original member without importing or executing its source."""
    with _verified_package(path, expected_sha256) as (_, _, manifest, _, summary, _):
        return {**summary, "status": "verified", "manifest": manifest}


def _open_directory(path, *, create=False):
    """Walk from the filesystem root using held ordinary-directory descriptors."""
    path = Path(path).expanduser().absolute()
    descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            if part in (".", ".."):
                raise ValueError("Select an ordinary receiving directory without traversal")
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                except FileExistsError:
                    pass
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=descriptor)
            os.close(descriptor)
            descriptor = following
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


@contextmanager
def _member_parent(root_fd, name, *, create=False):
    name = relative_path(name)
    descriptor = os.dup(root_fd)
    try:
        for part in PurePosixPath(name).parts[:-1]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                except FileExistsError:
                    pass
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=descriptor)
            os.close(descriptor)
            descriptor = following
        yield descriptor, PurePosixPath(name).name
    finally:
        os.close(descriptor)


def _current_member(root_fd, row):
    """Return False only for an absent member; differing bytes are preserved."""
    try:
        with _member_parent(root_fd, row["path"]) as (parent, name):
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     dir_fd=parent)
            except FileNotFoundError:
                return False
            with os.fdopen(descriptor, "rb") as stream:
                info, size, sha = _stream_identity(stream)
                if ((size, sha, stat.S_IMODE(info.st_mode))
                        != (row["bytes"], row["sha256"], row["mode"])):
                    raise ValueError("Preserve the changed receiving source: " + row["path"])
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if _identity(info) != _identity(current):
                    raise ValueError("The receiving source changed during readback: " + row["path"])
        return True
    except FileNotFoundError:
        return False


def _write_member(root_fd, row, source, *, staging_fd=None):
    if _current_member(root_fd, row):
        return False
    import secrets
    with _member_parent(root_fd, row["path"], create=True) as (parent, name):
        staging = parent if staging_fd is None else staging_fd
        temporary = ".runtime-source-" + secrets.token_hex(16)
        descriptor = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=staging)
        try:
            with os.fdopen(descriptor, "w+b") as target:
                digest, size = hashlib.sha256(), 0
                while block := source.read(BLOCK):
                    size += len(block)
                    if size > row["bytes"]:
                        raise ValueError("The source member grew during receiving: " + row["path"])
                    digest.update(block)
                    target.write(block)
                if (size, digest.hexdigest()) != (row["bytes"], row["sha256"]):
                    raise ValueError("The source member changed during receiving: " + row["path"])
                target.flush()
                os.fchmod(target.fileno(), row["mode"])
                os.fsync(target.fileno())
                try:
                    os.link(temporary, name, src_dir_fd=staging, dst_dir_fd=parent,
                            follow_symlinks=False)
                    created = True
                except FileExistsError:
                    _current_member(root_fd, row)
                    created = False
                os.fsync(parent)
        finally:
            os.unlink(temporary, dir_fd=staging)
            os.fsync(staging)
    return created


def _byte_row(name, raw, mode=0o600):
    return {"path": name, "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(), "mode": mode}


def _write_bytes(root_fd, name, raw):
    import io
    return _write_member(root_fd, _byte_row(name, raw), io.BytesIO(raw))


def _directory_files(root_fd, prefix=""):
    """Read the selected placement; refuse links and special files."""
    files = set()
    for name in os.listdir(root_fd):
        relative = prefix + name
        if not prefix and name == RECEIVING_DIRECTORY:
            continue
        info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=root_fd)
            try:
                files.update(_directory_files(descriptor, relative + "/"))
            finally:
                os.close(descriptor)
        elif stat.S_ISREG(info.st_mode):
            files.add(relative)
        else:
            raise ValueError("The receiving source contains a link or special file: " + relative)
    return files


def receive_package(path, output, *, expected_sha256):
    """Resume the same complete source placement without replacing any file.

The original ZIP, manifest, file modes and exact receiving path identify this
placement. Runtime job records, project inputs and installed third-party
dependencies are received through their own original workflows.
"""
    import fcntl
    with _verified_package(path, expected_sha256) as (archive, raw, manifest, files, summary, source_unchanged):
        output = Path(output).expanduser().absolute()
        root_fd = _open_directory(output, create=True)
        try:
            root_info = os.fstat(root_fd)
            expected = {MANIFEST_NAME, *files}
            before = _directory_files(root_fd)
            if before - expected:
                raise ValueError("The selected receiving directory contains unrelated source files")
            control_name = RECEIVING_DIRECTORY
            try:
                os.mkdir(control_name, 0o700, dir_fd=root_fd)
                os.fsync(root_fd)
            except FileExistsError:
                pass
            control_fd = os.open(control_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=root_fd)
            try:
                lock_fd = os.open("receive.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                                  0o600, dir_fd=control_fd)
                try:
                    if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
                        raise ValueError("The original source receiving lock is not a regular file")
                    try:
                        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        raise ValueError("Another process is receiving this source directory; reopen its current result") from None
                    selection = {"schema": RECEIVING_SCHEMA, "directory": str(output),
                                 "archive": {key: summary[key] for key in ("bytes", "sha256")},
                                 "source_manifest_sha256": summary["source_manifest_sha256"]}
                    selection_raw = (json.dumps(selection, sort_keys=True, indent=2) + "\n").encode()
                    _write_bytes(control_fd, "selection.json", selection_raw)
                    # Recheck the complete current placement under the same receiving lock.
                    before = _directory_files(root_fd)
                    if before - expected:
                        raise ValueError("The selected receiving directory changed before publication")
                    original_manifest = _byte_row(MANIFEST_NAME, raw)
                    rows = [original_manifest, *files.values()]
                    for row in rows:
                        _current_member(root_fd, row)
                    written = 0
                    import io
                    written += _write_member(root_fd, original_manifest, io.BytesIO(raw), staging_fd=control_fd)
                    for name, row in files.items():
                        with archive.open(name) as source:
                            written += _write_member(root_fd, row, source, staging_fd=control_fd)
                    if _directory_files(root_fd) != expected:
                        raise ValueError("The received source inventory changed before completion")
                    for row in rows:
                        if not _current_member(root_fd, row):
                            raise ValueError("The received source disappeared: " + row["path"])
                    if (root_info.st_dev, root_info.st_ino) != (
                            output.lstat().st_dev, output.lstat().st_ino):
                        raise ValueError("The receiving directory changed during publication")
                    source_unchanged()
                    completed = {**selection, "status": "complete",
                                 "source_files": len(files), "source_bytes": summary["source_bytes"],
                                 "entrypoints": summary["entrypoints"],
                                 "search_paths": summary["search_paths"]}
                    completed_raw = (json.dumps(completed, sort_keys=True, indent=2) + "\n").encode()
                    _write_bytes(control_fd, "complete.json", completed_raw)
                    os.fsync(control_fd)
                    os.fsync(root_fd)
                    return {**summary, "status": "received" if not before else
                            "resumed" if written else "reopened",
                            "directory": str(output), "files_written": written,
                            "files_unchanged": len(rows) - written,
                            "receiving_record": str(output / control_name / "complete.json"),
                            "manifest": manifest}
                finally:
                    os.close(lock_fd)
            finally:
                os.close(control_fd)
        finally:
            os.close(root_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    packing = commands.add_parser("pack", help="Retain exact selected local Python source and assets")
    packing.add_argument("--root", required=True, type=Path)
    packing.add_argument("--out", required=True, type=Path)
    packing.add_argument("--entrypoint", required=True, action="append")
    packing.add_argument("--asset", action="append", default=[])
    packing.add_argument("--search-path", action="append", default=[])
    inspect = commands.add_parser("inspect", help="Read every original archive member without execution")
    inspect.add_argument("--archive", required=True, type=Path)
    inspect.add_argument("--sha256")
    receiving = commands.add_parser("receive", help="Receive or reopen the same exact source placement")
    receiving.add_argument("--archive", required=True, type=Path)
    receiving.add_argument("--sha256", required=True)
    receiving.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.action == "pack":
            result = package_sources(args.root, args.out, entrypoints=args.entrypoint,
                                     assets=args.asset, search_paths=args.search_path or (".",))
        elif args.action == "inspect":
            result = inspect_package(args.archive, expected_sha256=args.sha256)
        else:
            result = receive_package(args.archive, args.out, expected_sha256=args.sha256)
    except (OSError, ValueError, TypeError, KeyError, RecursionError,
            zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        print(json.dumps({"status": "failed", "error": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
