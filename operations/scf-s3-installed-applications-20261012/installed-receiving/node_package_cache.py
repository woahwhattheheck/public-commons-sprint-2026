#!/usr/bin/env python3
"""Inspect or copy one exact package from an explicitly selected npm cache."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import zlib

SCHEMA = "commons.node_package_cache/v1"
MANIFEST_LIMIT = 1024 * 1024
DIGEST_BYTES = {"sha1": 20, "sha256": 32, "sha384": 48, "sha512": 64}


class SourceError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def positive_int(value):
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return parsed


def exact_text(value):
    if not value or value != value.strip() or "\x00" in value:
        raise argparse.ArgumentTypeError("must be nonempty without surrounding whitespace or NUL")
    return value


def integrity(value):
    algorithm, separator, encoded = value.partition("-")
    try:
        digest = base64.b64decode(encoded, validate=True)
    except ValueError:
        digest = b""
    if (not separator or algorithm not in DIGEST_BYTES
            or len(digest) != DIGEST_BYTES.get(algorithm)
            or base64.b64encode(digest).decode("ascii") != encoded):
        raise argparse.ArgumentTypeError(
            "use one canonical sha1-, sha256-, sha384- or sha512- base64 integrity value"
        )
    return value, algorithm, digest


def read_archive(path, limit):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as handle:
            before = os.fstat(handle.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise SourceError("CACHE_READ", "cached content is not a regular file")
            if before.st_size > limit:
                raise SourceError("LIMIT_EXCEEDED", "cached archive exceeds --max-archive-bytes")
            data = handle.read(limit + 1)
            after = os.fstat(handle.fileno())
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise SourceError("CACHE_READ", str(exc)) from exc
    if len(data) > limit:
        raise SourceError("LIMIT_EXCEEDED", "cached archive exceeds --max-archive-bytes")
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_size, after.st_mtime_ns, after.st_ctime_ns
    ):
        raise SourceError("CACHE_READ", "cached content changed while it was being read")
    return data


@contextmanager
def verified_source(path, args, report):
    """Snapshot only compressed bytes; expanded tar data stays streaming."""
    value, algorithm, expected = args.integrity
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    except FileNotFoundError:
        yield None
        return
    except OSError as exc:
        raise SourceError("CACHE_READ", str(exc)) from exc
    try:
        with os.fdopen(descriptor, "rb") as source, tempfile.TemporaryFile(
            dir=getattr(args, "scratch_root", None)
        ) as snapshot:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise SourceError("CACHE_READ", "cached content is not a regular file")
            if before.st_size > args.max_archive_bytes:
                raise SourceError("LIMIT_EXCEEDED", "cached archive exceeds --max-archive-bytes")
            wanted, sha256, size = hashlib.new(algorithm), hashlib.sha256(), 0
            while block := source.read(1024 * 1024):
                size += len(block)
                if size > args.max_archive_bytes:
                    raise SourceError("LIMIT_EXCEEDED", "cached archive exceeds --max-archive-bytes")
                wanted.update(block)
                sha256.update(block)
                snapshot.write(block)
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns
            ):
                raise SourceError("CACHE_READ", "cached content changed while it was being read")
            if wanted.digest() != expected:
                raise SourceError("INTEGRITY_MISMATCH", "cached archive does not match the supplied integrity")
            report["source"]["integrity_verified"] = True
            report["archive"] = {"bytes": size, "sha256": sha256.hexdigest()}
            snapshot.seek(0)
            yield snapshot
    except OSError as exc:
        raise SourceError("CACHE_READ", str(exc)) from exc


class ExpandedReader:
    """Bound gzip expansion without retaining the expanded archive in RAM."""
    def __init__(self, stream, limit):
        self.stream, self.limit, self.count = stream, limit, 0

    def read(self, size=-1):
        size = min(size if size >= 0 else 1024 * 1024,
                   self.limit - self.count + 1)
        block = self.stream.read(size)
        self.count += len(block)
        if self.count > self.limit:
            raise SourceError("LIMIT_EXCEEDED", "expanded archive exceeds --max-tar-bytes")
        return block


def member_path(name):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise SourceError("INVALID_ARCHIVE", f"invalid archive path: {name!r}")
    parts = name.rstrip("/").split("/")
    while parts and parts[0] == ".":
        parts.pop(0)
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise SourceError("INVALID_ARCHIVE", f"invalid archive path: {name!r}")
    # Drive-qualified names must not become absolute paths on Windows.
    if any(":" in part for part in parts):
        raise SourceError("INVALID_ARCHIVE", f"drive-qualified archive path: {name!r}")
    return tuple(parts)


def inspect_archive(archive, args, report):
    entries, roots, seen, directories = [], set(), set(), set()
    count, file_bytes = 0, 0
    manifest_member, manifest = None, None
    for member in archive:
        count += 1
        if count > args.max_members:
            raise SourceError("LIMIT_EXCEEDED", "archive exceeds --max-members")
        if member.issparse() or not (member.isfile() or member.isdir()):
            raise SourceError("INVALID_ARCHIVE", f"unsupported archive member type: {member.name!r}")
        parts = member_path(member.name)
        roots.add(parts[0])
        if len(roots) != 1:
            raise SourceError("INVALID_ARCHIVE", "archive must have one package root directory")
        relative = parts[1:]
        if relative in seen:
            raise SourceError("INVALID_ARCHIVE", f"duplicate archive path: {member.name!r}")
        seen.add(relative)
        if not relative:
            if not member.isdir():
                raise SourceError("INVALID_ARCHIVE", "archive root is not a directory")
            continue
        directories.update(relative[:index] for index in range(1, len(relative)))
        if member.isdir():
            directories.add(relative)
        else:
            if member.size < 0:
                raise SourceError("INVALID_ARCHIVE", f"negative file size: {member.name!r}")
            file_bytes += member.size
            if file_bytes > args.max_tar_bytes:
                raise SourceError("LIMIT_EXCEEDED", "package contents exceed --max-tar-bytes")
            if relative == ("package.json",):
                manifest_member = member
                if member.size > MANIFEST_LIMIT:
                    raise SourceError("LIMIT_EXCEEDED", "package.json exceeds the 1 MiB manifest limit")
                with archive.extractfile(member) as handle:
                    manifest = handle.read(MANIFEST_LIMIT + 1)
        entries.append((member, relative))
    if any(member.isfile() and relative in directories for member, relative in entries):
        raise SourceError("INVALID_ARCHIVE", "a package file is also used as a directory")
    if manifest_member is None:
        raise SourceError("INVALID_ARCHIVE", "archive has no root package.json file")
    if manifest_member.size > MANIFEST_LIMIT:
        raise SourceError("LIMIT_EXCEEDED", "package.json exceeds the 1 MiB manifest limit")
    if len(manifest) != manifest_member.size:
        raise SourceError("INVALID_ARCHIVE", "package.json is truncated")
    try:
        metadata = json.loads(manifest)
    except (ValueError, UnicodeError) as exc:
        raise SourceError("INVALID_ARCHIVE", f"package.json is not valid JSON: {exc}") from exc
    if not isinstance(metadata, dict):
        raise SourceError("INVALID_ARCHIVE", "package.json is not a JSON object")
    if metadata.get("name") != args.package or metadata.get("version") != args.version:
        raise SourceError(
            "PACKAGE_MISMATCH",
            f"expected {args.package!r}@{args.version!r}; "
            f"archive contains {metadata.get('name')!r}@{metadata.get('version')!r}",
        )
    engines = metadata.get("engines")
    node_engine = engines.get("node") if isinstance(engines, dict) else None
    report["package"] = {
        "name": metadata["name"], "version": metadata["version"],
        "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
        "manifest_bytes": len(manifest),
        "node_engine": node_engine if isinstance(node_engine, str) else None,
        "bin": metadata.get("bin"),
        "install_scripts": {key: value for key, value in metadata.get("scripts", {}).items()
                            if key in ("preinstall", "install", "postinstall")}
        if isinstance(metadata.get("scripts"), dict) else {},
    }
    report["archive"].update({
        "root": next(iter(roots)), "members": count,
        "files": sum(member.isfile() for member, _ in entries),
        "file_bytes": file_bytes,
    })
    return entries, directories


def materialize(archive, entries, directories, args, cache_root, report):
    requested = Path(args.destination).expanduser()
    try:
        parent = requested.parent.resolve(strict=True)
        if not parent.is_dir() or not requested.name:
            raise SourceError("DESTINATION_ERROR", "destination needs an existing parent directory")
        destination = parent / requested.name
        report["destination"]["path"] = str(destination)
        if destination == cache_root or cache_root in destination.parents:
            raise SourceError("DESTINATION_ERROR", "destination must be outside the source cache")
        if os.path.lexists(destination):
            raise SourceError("DESTINATION_EXISTS", "destination already exists; choose a new package directory")
        destination.mkdir(mode=0o755)
        report["destination"]["created"] = True
        for relative in sorted(directories, key=lambda parts: (len(parts), parts)):
            destination.joinpath(*relative).mkdir(mode=0o755)
        for member, relative in entries:
            if member.isdir():
                continue
            target = destination.joinpath(*relative)
            remaining = member.size
            with archive.extractfile(member) as source, target.open("xb") as output:
                while remaining:
                    block = source.read(min(1024 * 1024, remaining))
                    if not block:
                        raise SourceError("INVALID_ARCHIVE", f"truncated package file: {member.name!r}")
                    output.write(block)
                    remaining -= len(block)
                    report["destination"]["bytes_written"] += len(block)
            target.chmod(0o644 | (member.mode & 0o111))
            report["destination"]["files_written"] += 1
        report["destination"]["complete"] = True
    except (OSError, RuntimeError) as exc:
        raise SourceError("DESTINATION_ERROR", str(exc)) from exc


def run(args, report):
    try:
        cache_root = Path(args.cache_root).expanduser().resolve(strict=True)
        if not cache_root.is_dir():
            raise SourceError("CACHE_READ", "--cache-root is not a directory")
    except (OSError, RuntimeError) as exc:
        raise SourceError("CACHE_READ", str(exc)) from exc
    value, algorithm, digest = args.integrity
    key = digest.hex()
    path = cache_root / "content-v2" / algorithm / key[:2] / key[2:4] / key[4:]
    report["source"] = {"cache_root": str(cache_root), "path": str(path),
                        "integrity": value, "integrity_verified": False}
    try:
        with verified_source(path, args, report) as snapshot:
            if snapshot is None:
                report["outcome"] = "not_found_in_scope"
                return 1
            with gzip.GzipFile(fileobj=snapshot) as stream:
                expanded = ExpandedReader(stream, args.max_tar_bytes)
                with tarfile.open(fileobj=expanded, mode="r|") as archive:
                    entries, directories = inspect_archive(archive, args, report)
                while expanded.read(1024 * 1024):
                    pass
                report["archive"]["tar_bytes"] = expanded.count
            if getattr(args, "capture_paths", False):
                report["recovery_paths"] = [
                    {"path": "/".join(relative), "bytes": member.size,
                     "mode": 0o644 | (member.mode & 0o111)}
                    for member, relative in entries if member.isfile()
                ]
                report["recovery_directories"] = ["/".join(parts) for parts in sorted(directories)]
            if args.destination is not None:
                snapshot.seek(0)
                with tarfile.open(fileobj=snapshot, mode="r:gz") as archive:
                    materialize(archive, entries, directories, args, cache_root, report)
    except (OSError, EOFError, ValueError, tarfile.TarError, zlib.error) as exc:
        raise SourceError("INVALID_ARCHIVE", str(exc)) from exc
    report["outcome"] = "materialized" if args.destination is not None else "verified"
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", required=True, type=exact_text,
                        help="explicit npm _cacache directory; no cache root is inferred")
    parser.add_argument("--package", required=True, type=exact_text)
    parser.add_argument("--version", required=True, type=exact_text,
                        help="exact package.json version, not a semver range")
    parser.add_argument("--integrity", required=True, type=integrity,
                        help="one exact integrity value, preferably from the consumer's lockfile")
    parser.add_argument("--destination", type=exact_text,
                        help="copy package contents into this new directory; parent must exist")
    parser.add_argument("--max-archive-bytes", type=positive_int, default=32 * 1024 * 1024)
    parser.add_argument("--max-tar-bytes", type=positive_int, default=128 * 1024 * 1024)
    parser.add_argument("--max-members", type=positive_int, default=20000)
    parser.add_argument("--scratch-root", type=exact_text,
                        help="existing directory for the private compressed snapshot; default system temporary directory")
    args = parser.parse_args(argv)
    report = {
        "schema": SCHEMA,
        "observed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "request": {"cache_root": args.cache_root, "package": args.package,
                    "version": args.version, "integrity": args.integrity[0],
                    "destination": args.destination},
        "outcome": "error", "source": None, "archive": None, "package": None,
        "destination": {"path": args.destination, "created": False, "complete": False,
                        "files_written": 0, "bytes_written": 0}
        if args.destination is not None else None,
        "limits": {"max_archive_bytes": args.max_archive_bytes,
                   "max_tar_bytes": args.max_tar_bytes, "max_members": args.max_members,
                   "manifest_bytes": MANIFEST_LIMIT},
        "error": None,
    }
    try:
        code = run(args, report)
    except SourceError as exc:
        report["error"] = {"code": exc.code, "message": str(exc)}
        code = 2
    print(json.dumps(report, indent=2, ensure_ascii=True, allow_nan=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
