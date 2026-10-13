#!/usr/bin/env python3
"""Retire redundant caches or share immutable copies while preserving file paths.

Python 3.10+, standard library, Linux. See SWARM_CLOUD_CACHE.md for the
manifest and operator workflow. This changes only explicitly inventoried cloud
files; it is not an owner-device evacuation or general cache collector.
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import select
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

from file_use_guard import FileUseError, selected_file

VERSION = 1
RANGE_PLAN_VERSION = 2
TAR_PLAN_VERSION = 3
GIT_PLAN_VERSION = 4
CLOSED_RELEASE_PLAN_VERSION = 5
CHUNK = 1024 * 1024
READ_CACHE_BATCH = 8 * CHUNK
MARKER_LIMIT = 32768
MAX_CACHED_ZIPS = 4
SHARED_INODE_CONTRACT = "shared"
IMAGE_SUFFIXES = frozenset((".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
                            ".svg", ".ico", ".bmp", ".tif", ".tiff"))
PRIVATE_CUSTODY_DIRECTORIES = frozenset((
    "inbox", "outbox", "queue", "queues", "bodies", "ledger", "ledgers",
    "credentials", "secrets", ".ssh",
))
PRIVATE_CUSTODY_FILES = frozenset((
    "request.body", "response.body", "request-body.bin", "response-body.bin",
    ".env", "id_rsa", "id_ed25519", "id_ecdsa",
))
PRIVATE_RECORD_WORDS = frozenset((
    "config", "configuration", "ledger", "credential", "credentials", "secret",
    "secrets", "auth", "session", "state", "record", "request", "result", "response",
))


class CacheError(Exception):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def identity(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_bytes(path, data, *, new=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".cache-state-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if new:
            os.link(tmp, path)
        else:
            os.replace(tmp, path)
        sync_dir(path.parent)
    finally:
        Path(tmp).unlink(missing_ok=True)


def atomic_json(path, value, *, new=False):
    from cache_metadata import write_metadata_bytes
    write_metadata_bytes(path, encoded(value), atomic_bytes, new=new)


def read_json(path):
    from cache_metadata import read_metadata_bytes
    return json.loads(read_metadata_bytes(path))


def relative_name(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise CacheError("Each entry needs a nonempty relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value or value == ".":
        raise CacheError(f"Use an exact normalized path beneath cache_root: {value!r}")
    return value


@contextlib.contextmanager
def parent_fd(root, relative, *, create=False):
    """Walk directory descriptors so a replaced/symlinked parent is not followed."""
    parts = PurePosixPath(relative_name(relative)).parts
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd, parts[-1]
    finally:
        os.close(fd)


def release_read_cache(fd, offset, length):
    """Suggest discarding consumed file pages; correctness never depends on it."""
    advise = getattr(os, "posix_fadvise", None)
    dontneed = getattr(os, "POSIX_FADV_DONTNEED", None)
    if advise is None or dontneed is None or not length:
        return False
    try:
        advise(fd, offset, length, dontneed)
        return True
    except OSError:
        return False


def hash_stream(stream, limit=None, output=None, *, release_fd=None):
    h, total, released = hashlib.sha256(), 0, 0
    while limit is None or total < limit:
        chunk = stream.read(CHUNK if limit is None else min(CHUNK, limit - total))
        if not chunk:
            break
        h.update(chunk)
        total += len(chunk)
        if output is not None:
            output.write(chunk)
        if release_fd is not None and total - released >= READ_CACHE_BATCH:
            if not release_read_cache(release_fd, released, total - released):
                release_fd = None
            released = total
    if release_fd is not None:
        release_read_cache(release_fd, released, total - released)
    return {"sha256": h.hexdigest(), "size": total}


def inspect_fd(fd):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):
        raise CacheError("Cache and retained inputs must be regular files")
    with os.fdopen(os.dup(fd), "rb") as stream:
        stream.seek(0)
        # This is a complete one-pass checksum, starting at byte zero. Release
        # only consumed regions; pipes, member streams and output files retain
        # their existing behavior. The descriptor stays open for identity checks.
        data = hash_stream(stream, release_fd=fd if before.st_size >= READ_CACHE_BATCH else None)
    after = os.fstat(fd)
    if identity(before) != identity(after):
        raise CacheError("File changed while its bytes were being read; bytes preserved")
    return {**data, "allocated_bytes": after.st_blocks * 512,
            "mode": stat.S_IMODE(after.st_mode), "links": after.st_nlink,
            "identity": list(identity(after))}


def snapshot(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        return inspect_fd(fd)
    finally:
        os.close(fd)


def same_bytes(actual, expected):
    return all(actual.get(key) == expected.get(key) for key in ("sha256", "size"))


def shared_inode_contract(ownership, *, inode_contract=None):
    """An immutable payload can still have a reader that requires st_nlink == 1."""
    if inode_contract not in (None, SHARED_INODE_CONTRACT):
        raise CacheError("The explicit reader acknowledgment must be shared")
    selected = ownership.get("inode_contract", inode_contract) if isinstance(ownership, dict) else None
    if selected != SHARED_INODE_CONTRACT:
        raise CacheError("Coalescing requires ownership.inode_contract: shared after checking both paths' readers; "
                         "retain independent files for readers requiring one link")


def private_custody_path(path, mode):
    """Recognize operational custody paths, without reading or printing their data."""
    parts = [part.lower() for part in Path(path).parts]
    name = parts[-1] if parts else ""
    if (set(parts[:-1]) & PRIVATE_CUSTODY_DIRECTORIES or
            name in PRIVATE_CUSTODY_FILES or name.endswith((".body", ".queue", ".ledger"))):
        return True
    # An image name such as state-park.webp is not an operational record.
    # The unconditional private path/name checks above still apply to images.
    if Path(name).suffix in IMAGE_SUFFIXES:
        return False
    # Owner-private control files need separate inodes even when their bytes have
    # stopped changing. Public package source/configuration is not inferred private.
    words = set(re.split(r"[^a-z0-9]+", name))
    return mode is not None and mode & 0o077 == 0 and bool(words & PRIVATE_RECORD_WORDS)


def coalesce_entry_contract(plan, entry, *, inode_contract=None):
    mode = entry.get("metadata", {}).get("mode")
    for path in (Path(plan["cache_root"]) / entry["path"], Path(entry["custody"]["path"])):
        if private_custody_path(path, mode):
            raise CacheError(f"Private queue, body, configuration or ledger custody requires an independent inode: {path}")
    shared_inode_contract(plan.get("ownership"), inode_contract=inode_contract)


def coalesce_metadata(fd):
    """Compare permissions and extended attributes without exposing their values."""
    before = os.fstat(fd)
    attributes = hashlib.sha256()
    for name in sorted(os.listxattr(fd)):
        key, value = os.fsencode(name), os.getxattr(fd, name)
        attributes.update(len(key).to_bytes(8, "big") + key)
        attributes.update(len(value).to_bytes(8, "big") + value)
    if identity(before) != identity(os.fstat(fd)):
        raise CacheError("File metadata changed during inspection; bytes preserved")
    return {"mode": stat.S_IMODE(before.st_mode), "uid": before.st_uid,
            "gid": before.st_gid, "xattrs_sha256": attributes.hexdigest()}


def inspect_coalesce_fd(fd, entry=None):
    actual = inspect_fd(fd)
    actual["metadata"] = coalesce_metadata(fd)
    if actual["identity"] != list(identity(os.fstat(fd))):
        raise CacheError("File changed between content and metadata inspection")
    if entry is not None:
        if not same_bytes(actual, entry["original"]):
            raise CacheError(f"Immutable content changed; preserved: {entry['path']}")
        if actual["metadata"] != entry["metadata"]:
            raise CacheError(f"Immutable permissions or extended attributes changed: {entry['path']}")
    return actual


@contextlib.contextmanager
def retained_file(entry):
    """Pin every directory and the selected retained regular file, without symlinks."""
    absolute = Path(entry["custody"]["path"])
    with parent_fd(absolute.anchor, str(absolute.relative_to(absolute.anchor))) as (directory, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            yield fd, directory, name
        finally:
            os.close(fd)


def inode_at(directory, name):
    observed = os.stat(name, dir_fd=directory, follow_symlinks=False)
    if not stat.S_ISREG(observed.st_mode):
        raise CacheError("An immutable file path is no longer a regular file")
    return (observed.st_dev, observed.st_ino)


def exchange_file_names(staged, directory, name):
    """Perform only the atomic exchange; the original caller owns directory sync."""
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        exchange = libc.renameat2
    except AttributeError:
        raise CacheError("Atomic coalescing requires Linux renameat2(RENAME_EXCHANGE)")
    exchange.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                         ctypes.c_char_p, ctypes.c_uint]
    exchange.restype = ctypes.c_int
    if exchange(-100, os.fsencode(staged), directory, os.fsencode(name), 2):
        number = ctypes.get_errno()
        raise OSError(number, "Atomic coalescing exchange failed; both files retained")


def exchange_file(staged, directory, name):
    """Keep both names present and preserve the replaced inode for inspection."""
    exchange_file_names(staged, directory, name)
    os.fsync(directory)
    sync_dir(Path(staged).parent)


def discard_coalesce_stage(staged, entry):
    fd = os.open(staged, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        actual = inspect_coalesce_fd(fd, entry)
        if identity(os.stat(staged, follow_symlinks=False)) != identity(os.fstat(fd)):
            raise CacheError(f"Staging path changed; preserved: {staged}")
        released = actual["allocated_bytes"] if actual["links"] == 1 else 0
        Path(staged).unlink()
        sync_dir(Path(staged).parent)
        return released
    finally:
        os.close(fd)


def marker_for(plan, entry):
    marker = {"commons_cloud_cache_retired": VERSION, "plan_id": plan["plan_id"],
            "operation_id": plan["operation_id"], "entry_id": entry["id"],
            "path": entry["path"], "original": entry["original"],
            "match": entry["match"], "custody": entry["custody"],
            "retired_at": now(),
            "recovery": "Use swarm_cloud_cache.py restore with the saved plan and a new destination."}
    if entry["match"] == "range":
        marker["offset"] = entry["offset"]
    return marker


def is_marker(value, plan, entry):
    return (isinstance(value, dict) and value.get("commons_cloud_cache_retired") == VERSION
            and value.get("plan_id") == plan["plan_id"] and value.get("entry_id") == entry["id"]
            and value.get("path") == entry["path"] and value.get("original") == entry["original"]
            and value.get("custody") == entry["custody"] and value.get("match") == entry["match"]
            and value.get("offset") == entry.get("offset"))


def inspect_target(plan, entry):
    try:
        with parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                s = os.fstat(fd)
                if not stat.S_ISREG(s.st_mode):
                    return {"state": "changed", "reason": "Not a regular file"}
                if s.st_size <= MARKER_LIMIT:
                    raw = os.read(fd, MARKER_LIMIT)
                    try:
                        value = json.loads(raw)
                    except (ValueError, UnicodeError):
                        value = None
                    if is_marker(value, plan, entry):
                        return {"state": "retired", "size": s.st_size,
                                "allocated_bytes": s.st_blocks * 512,
                                "identity": list(identity(s)), "links": s.st_nlink}
                data = inspect_coalesce_fd(fd) if plan.get("strategy") == "coalesce" else inspect_fd(fd)
                matches = same_bytes(data, entry["original"])
                if plan.get("strategy") == "coalesce":
                    matches = matches and data["metadata"] == entry["metadata"]
                return {"state": "original" if matches else "changed", **data}
            finally:
                os.close(fd)
    except FileNotFoundError:
        return {"state": "missing"}


def git_oid(value, object_format=None):
    lengths = {"sha1": 40, "sha256": 64}
    length = lengths.get(object_format)
    if (not isinstance(value, str) or len(value) not in (40, 64)
            or (length is not None and len(value) != length)
            or any(char not in "0123456789abcdef" for char in value)):
        raise CacheError("Git custody requires an exact full lowercase object ID")
    return value


def git_environment():
    # Ignore inherited repositories, replacement refs, alternates and credentials.
    # Local object reads never invoke a promisor fetch, protocol, hook or filter.
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_SYSTEM=os.devnull,
                       GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0",
                       GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1",
                       GIT_OPTIONAL_LOCKS="0", GIT_ALLOW_PROTOCOL="",
                       GIT_ATTR_NOSYSTEM="1")
    return environment


def git_command(path, arguments):
    return ["git", "--no-pager", "--no-replace-objects", "--no-lazy-fetch",
            "--literal-pathspecs", "--git-dir=" + str(path),
            "-c", "core.hooksPath=" + os.devnull,
            "-c", "core.fsmonitor=false", "-c", "protocol.allow=never",
            "-c", "credential.helper=", "-c", "gc.auto=0",
            "-c", "maintenance.auto=false", *arguments]


def git_run(path, arguments, data=None, accepted=(0,)):
    try:
        result = subprocess.run(git_command(path, arguments), input=data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=git_environment(), cwd="/", timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise CacheError(f"Local Git {arguments[0]} timed out: {path}") from exc
    if result.returncode not in accepted:
        # Config errors may contain credential-bearing values; keep stderr private.
        raise CacheError(f"Local Git {arguments[0]} failed with exit {result.returncode}: {path}")
    if len(result.stdout) > 8 * CHUNK:
        raise CacheError("Git custody metadata exceeds the 8 MiB response limit")
    return result


def git_path(raw):
    """Decode Git's C-quoted count-objects path without shell evaluation."""
    if raw.startswith(b'"'):
        if not raw.endswith(b'"'):
            raise CacheError("Git returned an incomplete quoted backing path")
        out, index = bytearray(), 1
        escapes = {ord("a"): 7, ord("b"): 8, ord("t"): 9, ord("n"): 10,
                   ord("v"): 11, ord("f"): 12, ord("r"): 13,
                   ord("\\"): 92, ord('"'): 34}
        while index < len(raw) - 1:
            char = raw[index]
            index += 1
            if char != 92:
                out.append(char)
            else:
                if index >= len(raw) - 1:
                    raise CacheError("Git returned an incomplete backing-path escape")
                char = raw[index]
                index += 1
                if char in escapes:
                    out.append(escapes[char])
                elif 48 <= char <= 51 and index + 2 <= len(raw) - 1:
                    digits = bytes([char]) + raw[index:index + 2]
                    if any(value not in b"01234567" for value in digits):
                        raise CacheError("Git returned an invalid octal backing path")
                    out.append(int(digits, 8))
                    index += 2
                else:
                    raise CacheError("Git returned an unsupported backing-path escape")
        raw = bytes(out)
    value = os.fsdecode(raw)
    if not value or any(char in value for char in ("\0", "\r", "\n")):
        raise CacheError("Git backing directories must have exact single-line paths")
    return Path(value).resolve(strict=True)


def git_backing_paths(plan):
    return sorted({row["path"] for entry in plan["entries"]
                   if entry["custody"]["kind"] == "git-blob"
                   for row in entry["custody"].get("git_backings", [])})


def beneath(path, root):
    path, root = Path(path), Path(root)
    return path == root or root in path.parents


class GitBatch:
    """One owned cat-file process per repository, with bounded pipe reads."""
    def __init__(self, path):
        self.path, self.buffer = path, bytearray()
        self.process = subprocess.Popen(git_command(path, ["cat-file", "--batch"]),
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, bufsize=0,
                                        env=git_environment(), cwd="/")
        self.closed = False

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.process.stdin.close()
        self.process.stdout.close()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

    def _read(self, size):
        ready, _, _ = select.select([self.process.stdout], [], [], 30)
        if not ready:
            raise CacheError(f"Local Git object read timed out: {self.path}")
        return os.read(self.process.stdout.fileno(), size)

    def read(self, size):
        if self.buffer:
            size = min(size, len(self.buffer))
            value = bytes(self.buffer[:size])
            del self.buffer[:size]
            return value
        return self._read(size)

    def header(self, object_id):
        pending = memoryview((object_id + "\n").encode("ascii"))
        while pending:
            written = self.process.stdin.write(pending)
            if not written:
                raise CacheError("Local Git object request was interrupted")
            pending = pending[written:]
        while b"\n" not in self.buffer:
            if len(self.buffer) > 256:
                raise CacheError("Local Git returned an invalid object header")
            chunk = self._read(4096)
            if not chunk:
                raise CacheError(f"Local Git ended before returning object {object_id}")
            self.buffer.extend(chunk)
        offset = self.buffer.index(b"\n")
        if offset > 256:
            raise CacheError("Local Git returned an oversized object header")
        line = bytes(self.buffer[:offset])
        del self.buffer[:offset + 1]
        fields = line.split(b" ")
        if (len(fields) != 3 or fields[0] != object_id.encode("ascii")
                or fields[1] != b"blob" or not fields[2].isdigit()):
            raise CacheError(f"Exact Git blob is not locally available: {object_id}")
        return int(fields[2])


class GitBlobStream:
    """Forward seeking consumes bytes and hashes the complete original blob."""
    def __init__(self, batch, spec, object_format):
        self.batch, self.spec, self.position = batch, spec, 0
        self.size = batch.header(spec["object_id"])
        if spec.get("size") is not None and self.size != spec["size"]:
            raise CacheError("Git blob size differs from the retained specification")
        self.sha256 = hashlib.sha256()
        self.object_hash = hashlib.new(object_format)
        self.object_hash.update(b"blob " + str(self.size).encode("ascii") + b"\0")

    def read(self, size=-1):
        remaining = self.size - self.position
        size = remaining if size is None or size < 0 else min(size, remaining)
        if not size:
            return b""
        value = self.batch.read(min(size, CHUNK))
        if not value:
            raise CacheError("Git blob ended before its recorded byte count")
        self.position += len(value)
        self.sha256.update(value)
        self.object_hash.update(value)
        return value

    def seek(self, offset, whence=0):
        if whence != 0 or type(offset) is not int or not self.position <= offset <= self.size:
            raise CacheError("Git custody only supports a forward absolute range offset")
        while self.position < offset:
            self.read(min(CHUNK, offset - self.position))
        return self.position

    def finish(self):
        while self.position < self.size:
            self.read(CHUNK)
        if self.batch.read(1) != b"\n":
            raise CacheError("Git blob delimiter is missing")
        if self.spec.get("sha256") is not None and self.sha256.hexdigest() != self.spec["sha256"]:
            raise CacheError("Complete raw Git blob SHA-256 differs from custody")
        if self.object_hash.hexdigest() != self.spec["object_id"]:
            raise CacheError("Git object bytes differ from their immutable object ID")


class GitRepository:
    """Pin the selected existing objects without duplicating their payloads."""
    def __init__(self, path):
        self.path = Path(path)
        if not self.path.is_absolute() or self.path.resolve(strict=True) != self.path:
            raise CacheError("Git custody path must be the canonical common Git directory")
        self.objects = self.path / "objects"
        for directory in (self.path, self.objects):
            if not stat.S_ISDIR(directory.lstat().st_mode):
                raise CacheError(f"Git custody requires a real retained directory: {directory}")
        self.watched = (self.path / "config", self.path / "commondir",
                        self.objects / "info" / "alternates")
        self.baseline = self.observation()
        common = git_path(git_run(path, ["rev-parse", "--path-format=absolute",
                                        "--git-common-dir"]).stdout.rstrip(b"\n"))
        if common != self.path:
            raise CacheError(f"Use the retained common Git directory: {common}")
        self.object_format = git_run(path, ["rev-parse", "--show-object-format"]).stdout.strip().decode("ascii")
        if self.object_format not in ("sha1", "sha256"):
            raise CacheError("Unsupported Git repository object format")
        self.ref_format = git_run(path, ["rev-parse", "--show-ref-format"]).stdout.strip().decode("ascii")
        self.alternates = set()
        listing = git_run(path, ["count-objects", "-v"]).stdout
        for line in listing.splitlines():
            if line.startswith(b"alternate: "):
                objects = git_path(line[len(b"alternate: "):])
                if objects.name != "objects" or not stat.S_ISDIR(objects.lstat().st_mode):
                    raise CacheError("An alternate must belong to an explicit retained common Git directory")
                self.alternates.add(str(objects.parent))
        self.unchanged()
        self.batch, self.pins = None, {}

    @staticmethod
    def optional_identity(path):
        try:
            value = path.lstat()
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(value.st_mode):
            raise CacheError(f"Git custody metadata must be a regular file: {path}")
        return identity(value)

    def observation(self):
        directories = []
        for path in (self.path, self.objects):
            value = path.lstat()
            if not stat.S_ISDIR(value.st_mode):
                raise CacheError(f"Git backing directory was replaced: {path}")
            directories.append((value.st_dev, value.st_ino))
        return (tuple(directories), tuple(self.optional_identity(path) for path in self.watched))

    def unchanged(self):
        if self.observation() != self.baseline:
            raise CacheError(f"Git backing layout changed during this invocation: {self.path}")

    def close(self):
        if self.batch is not None:
            self.batch.close()
            self.batch = None

    def pin_signature(self, reference):
        if self.ref_format != "files":
            return None
        return (self.optional_identity(self.path / reference),
                self.optional_identity(self.path / "packed-refs"))

    def verify_pin(self, row):
        self.unchanged()
        tree = git_oid(row.get("pin_tree"), self.object_format)
        reference = row.get("pin_ref")
        if reference != "refs/commons-cache-custody/" + tree:
            raise CacheError("Git custody pin reference differs from its immutable tree")
        signature = self.pin_signature(reference)
        cached = self.pins.get(reference)
        if signature is not None and cached is not None and cached[0] == signature:
            return cached[1]
        symbolic = git_run(self.path, ["symbolic-ref", "-q", reference], accepted=(0, 1))
        if symbolic.returncode == 0:
            raise CacheError("Git custody pin must be a direct immutable reference")
        value = git_run(self.path, ["rev-parse", "--verify", "--quiet", reference],
                        accepted=(0, 1))
        if value.returncode or value.stdout.strip().decode("ascii") != tree:
            raise CacheError(f"Retained Git custody pin is unavailable: {reference}")
        data = git_run(self.path, ["cat-file", "tree", tree]).stdout
        expected = hashlib.new(self.object_format)
        expected.update(b"tree " + str(len(data)).encode("ascii") + b"\0" + data)
        if expected.hexdigest() != tree:
            raise CacheError("Git custody tree bytes differ from their immutable object ID")
        members, offset, oid_bytes = set(), 0, len(tree) // 2
        while offset < len(data):
            boundary = data.find(b"\0", offset)
            if boundary < 0 or boundary + 1 + oid_bytes > len(data):
                raise CacheError("Git custody pin tree has an incomplete entry")
            fields = data[offset:boundary].split(b" ")
            member = data[boundary + 1:boundary + 1 + oid_bytes].hex()
            if fields != [b"100644", member.encode("ascii")] or member in members:
                raise CacheError("Git custody pin tree does not name unique exact blobs")
            members.add(member)
            offset = boundary + 1 + oid_bytes
        self.unchanged()
        self.pins[reference] = (signature, members)
        return members

    def pin(self, selected):
        self.unchanged()
        object_ids = sorted(selected)
        for object_id in object_ids:
            git_oid(object_id, self.object_format)
        response = git_run(self.path, ["cat-file", "--batch-check"],
                           ("\n".join(object_ids) + "\n").encode("ascii")).stdout.splitlines() if object_ids else []
        if len(response) != len(object_ids):
            raise CacheError("Git did not return all selected object metadata")
        available = []
        for object_id, line in zip(object_ids, response):
            if line == (object_id + " missing").encode("ascii"):
                continue
            fields = line.split(b" ")
            if (len(fields) != 3 or fields[0] != object_id.encode("ascii")
                    or fields[1] != b"blob" or not fields[2].isdigit()
                    or int(fields[2]) != selected[object_id]["size"]):
                raise CacheError(f"Git backing object metadata changed: {object_id}")
            available.append(object_id)
        tree_input = b"".join(("100644 blob " + value + "\t" + value + "\0").encode("ascii")
                              for value in available)
        tree = git_oid(git_run(self.path, ["mktree", "-z"], tree_input).stdout.strip().decode("ascii"),
                       self.object_format)
        row = {"path": str(self.path), "pin_ref": "refs/commons-cache-custody/" + tree,
               "pin_tree": tree}
        # Create-only CAS. A surviving identical reference resumes this same pin;
        # a different reference is never changed or deleted.
        git_run(self.path, ["update-ref", "--no-deref", row["pin_ref"], tree, "0" * len(tree)],
                accepted=(0, 1, 128))
        members = self.verify_pin(row)
        if members != set(available):
            raise CacheError("Git custody tree differs from the selected existing objects")
        return row, members


class Custody:
    """Verify retained containers and stream exact pinned Git objects."""
    def __init__(self, *, planning=False, require_pins=True, custody_files=None):
        self.custody_files = dict(custody_files or {})
        self.verified, self.repositories = {}, {}
        self.files, self.chains = {}, {}
        self.tar_members = {}
        self.zip_archives = {}
        self.selected_paths, self.selected_inodes = set(), set()
        self.planning, self.require_pins = planning, require_pins

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        with contextlib.ExitStack() as closing:
            for repository in self.repositories.values():
                closing.callback(repository.close)
            for cached in self.zip_archives.values():
                closing.callback(cached["handles"].close)
            self.zip_archives.clear()

    def protect_selected(self, paths, inodes=()):
        """Keep every resolved custody link outside this retirement selection."""
        self.selected_paths.update(str(path) for path in paths)
        self.selected_inodes.update(inodes)
        for path, observed in self.files.items():
            self.check_selected(path, observed)

    def check_selected(self, path, observed):
        if path in self.selected_paths or observed[:2] in self.selected_inodes:
            raise CacheError(f"Retained container is also a selected cache file: {path}")

    def recovery_details(self, spec):
        chain = self.chains.get((spec["path"], spec["sha256"], spec["size"]), ())
        return {"custody_chain": list(chain)} if len(chain) > 1 else {}

    @contextlib.contextmanager
    def container(self, spec):
        """Read the original seekable bytes through complete-file retirement links."""
        path, opened, seen = self.custody_files.get(spec["path"], spec["path"]), [], set()
        with contextlib.ExitStack() as handles:
            while True:
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                stream = handles.enter_context(os.fdopen(fd, "rb"))
                start = os.fstat(fd)
                observed = identity(start)
                if not stat.S_ISREG(start.st_mode):
                    raise CacheError(f"Retained container must be a regular file: {path}")
                if observed[:2] in seen:
                    raise CacheError(f"Retained custody chain contains a cycle: {path}")
                seen.add(observed[:2])
                self.check_selected(path, observed)
                opened.append((path, stream, observed))
                key = (path, spec["sha256"], spec["size"], observed)
                if key in self.verified or same_bytes(inspect_fd(fd), spec):
                    self.verified[key] = True
                    break
                # Markers are routing records only. Each link must retain the
                # same complete container; members/prefixes cannot stand in for it.
                if start.st_size > MARKER_LIMIT:
                    raise CacheError(f"Retained container changed: {path}")
                stream.seek(0)
                try:
                    marker = json.loads(stream.read(MARKER_LIMIT + 1))
                except (ValueError, UnicodeError) as exc:
                    raise CacheError(f"Retained container changed: {path}") from exc
                if isinstance(marker, dict) and marker.get("commons_library_custody"):
                    raise CacheError("Library custody requires explicit materialization of its original request: "
                                     + str(marker.get("request_path", path)))
                if (not isinstance(marker, dict)
                        or type(marker.get("commons_cloud_cache_retired")) is not int
                        or marker["commons_cloud_cache_retired"] != VERSION
                        or not isinstance(marker.get("original"), dict)
                        or not same_bytes(marker["original"], spec)
                        or marker.get("match") != "complete" or marker.get("offset", 0) != 0
                        or not isinstance(marker.get("custody"), dict)
                        or marker["custody"].get("kind") != "file"
                        or not same_bytes(marker["custody"], spec)):
                    raise CacheError(f"Retained marker does not preserve the complete planned container: {path}")
                try:
                    path = custody_spec(marker["custody"])["path"]
                except (KeyError, TypeError, ValueError, OSError) as exc:
                    raise CacheError(f"Retained marker has invalid file custody: {path}: {exc}") from exc
            stream.seek(0)
            yield stream, start.st_size
            for opened_path, opened_stream, observed in opened:
                if observed != identity(os.fstat(opened_stream.fileno())):
                    raise CacheError(f"Retained container changed during the read: {opened_path}")
                if observed != identity(os.stat(opened_path, follow_symlinks=False)):
                    raise CacheError(f"Retained path was replaced during the read: {opened_path}")
            self.files.update((name, observed) for name, _, observed in opened)
            self.chains[(spec["path"], spec["sha256"], spec["size"])] = tuple(name for name, _, _ in opened)

    def repository(self, path):
        if path not in self.repositories:
            self.repositories[path] = GitRepository(path)
        return self.repositories[path]

    def git_roots(self, spec):
        roots, pending = set(), [spec["path"]]
        expected_format = self.repository(spec["path"]).object_format
        while pending:
            path = pending.pop()
            if path in roots:
                continue
            repository = self.repository(path)
            repository.unchanged()
            if repository.object_format != expected_format:
                raise CacheError("Retained Git alternates use a different object format")
            roots.add(path)
            pending.extend(repository.alternates - roots)
        return roots

    def verify_git_backings(self, spec):
        repository = self.repository(spec["path"])
        git_oid(spec["object_id"], repository.object_format)
        roots = self.git_roots(spec)
        if self.planning or not self.require_pins:
            return roots
        backings = spec.get("git_backings")
        if (not isinstance(backings, list) or
                len(backings) != len(roots) or
                {row.get("path") for row in backings if isinstance(row, dict)} != roots):
            raise CacheError("Git custody backing directories differ from the frozen plan")
        for row in backings:
            members = self.repository(row["path"]).verify_pin(row)
            if row["path"] == spec["path"] and spec["object_id"] not in members:
                raise CacheError("Original Git blob is absent from its retained custody tree")
        return roots

    def pin_git(self, entries):
        groups, roots_by_primary = {}, {}
        for entry in entries:
            spec = entry["custody"]
            if spec["kind"] != "git-blob":
                continue
            roots = roots_by_primary.setdefault(spec["path"], self.git_roots(spec))
            for path in roots:
                group = groups.setdefault(path, {})
                previous = group.get(spec["object_id"])
                expected = {key: spec[key] for key in ("sha256", "size")}
                if previous is not None and previous != expected:
                    raise CacheError("One Git object ID has inconsistent retained content")
                group[spec["object_id"]] = expected
        pinned = {path: self.repository(path).pin(selected)[0]
                  for path, selected in sorted(groups.items())}
        for entry in entries:
            spec = entry["custody"]
            if spec["kind"] == "git-blob":
                spec["git_backings"] = [pinned[path] for path in sorted(roots_by_primary[spec["path"]])]
        self.planning = False
        for entry in entries:
            if entry["custody"]["kind"] == "git-blob":
                self.verify_git_backings(entry["custody"])

    @contextlib.contextmanager
    def git_source(self, spec):
        roots = self.verify_git_backings(spec)
        repository = self.repository(spec["path"])
        if repository.batch is None or repository.batch.closed:
            repository.batch = GitBatch(repository.path)
        try:
            stream = GitBlobStream(repository.batch, spec, repository.object_format)
            yield stream, stream.size
            # Complete/prefix/range all verify the entire raw blob as well as the
            # selected original bytes. No seekable body copy is materialized.
            stream.finish()
            for path in roots:
                self.repository(path).unchanged()
            self.verify_git_backings(spec)
        except BaseException:
            repository.close()
            raise

    def zip_index(self, spec, stream):
        """Reuse at most four ZIP directories for unchanged verified containers."""
        key = (spec["path"], spec["sha256"], spec["size"],
               identity(os.fstat(stream.fileno())))
        cached = self.zip_archives.pop(key, None)
        if cached is not None:
            self.zip_archives[key] = cached
            return cached
        if len(self.zip_archives) >= MAX_CACHED_ZIPS:
            oldest = next(iter(self.zip_archives))
            self.zip_archives.pop(oldest)["handles"].close()
        handles = contextlib.ExitStack()
        try:
            # Retain the verified inode, not a second pathname lookup. The
            # surrounding container() still verifies every marker/path before
            # and after each member read, including a cached digest hit.
            retained = handles.enter_context(os.fdopen(os.dup(stream.fileno()), "rb"))
            archive = handles.enter_context(zipfile.ZipFile(retained))
            members = {}
            for item in archive.infolist():
                if item.filename in members or item.is_dir():
                    members[item.filename] = None
                else:
                    members[item.filename] = item
            cached = {"handles": handles, "archive": archive,
                      "members": members, "digests": {}}
        except BaseException:
            handles.close()
            raise
        self.zip_archives[key] = cached
        return cached

    def complete_zip_member(self, spec, *, expected_size):
        """Hash each selected complete member once per verified container."""
        with self.container(spec) as (stream, _):
            cached = self.zip_index(spec, stream)
            item = cached["members"].get(spec["member"])
            if item is None:
                raise CacheError(f"ZIP member must identify exactly one file: {spec['member']}")
            if item.file_size != expected_size:
                raise CacheError(f"Retained content size differs for ZIP member: {spec['member']}")
            actual = cached["digests"].get(spec["member"])
            if actual is None:
                with cached["archive"].open(item) as member:
                    actual = hash_stream(member)
                if actual["size"] != item.file_size:
                    raise CacheError(f"ZIP member is incomplete: {spec['member']}")
        # Retain a digest only after the unchanged container and all of its
        # routing paths have passed their original post-read checks.
        cached["digests"][spec["member"]] = actual
        return dict(actual)

    @contextlib.contextmanager
    def source(self, spec):
        if spec["kind"] == "git-blob":
            with self.git_source(spec) as source:
                yield source
            return
        path = spec["path"]
        with self.container(spec) as (stream, size):
            if spec["kind"] == "file":
                yield stream, size
            elif spec["kind"] == "zip-member":
                cached = self.zip_index(spec, stream)
                item = cached["members"].get(spec["member"])
                if item is None:
                    raise CacheError(f"ZIP member must identify exactly one file: {spec['member']}")
                with cached["archive"].open(item) as member:
                    yield member, item.file_size
            elif spec["kind"] == "tar-member":
                try:
                    with tarfile.open(fileobj=stream, mode="r:*") as archive:
                        matches = [item for item in archive if item.name == spec["member"]]
                        if len(matches) != 1 or not matches[0].isfile():
                            raise CacheError(f"TAR member must identify exactly one regular file: {spec['member']}")
                        member = archive.extractfile(matches[0])
                        if member is None:
                            raise CacheError(f"TAR member cannot be read: {spec['member']}")
                        with member:
                            yield member, matches[0].size
                except (tarfile.TarError, EOFError) as exc:
                    raise CacheError(f"Retained TAR cannot be read: {path}: {exc}") from exc
            else:
                raise CacheError(f"Unsupported custody kind: {spec['kind']}")

    def complete_tar_member(self, spec):
        """Hash all regular members once per unchanged verified TAR container."""
        with self.container(spec) as (stream, _):
            # container() still resolves and checks every retained marker link
            # on cache hits, including selected-path/inode exclusions. The final
            # opened identity invalidates digests after any underlying change.
            key = (spec["path"], spec["sha256"], spec["size"],
                   identity(os.fstat(stream.fileno())))
            members = self.tar_members.get(key)
            if members is None:
                members = {}
                try:
                    with tarfile.open(fileobj=stream, mode="r|*") as archive:
                        for item in archive:
                            if item.name in members or not item.isfile():
                                # A duplicate of any kind must never become an
                                # unambiguous regular-file custody reference.
                                members[item.name] = None
                                continue
                            member = archive.extractfile(item)
                            if member is None:
                                raise CacheError(f"TAR member cannot be read: {item.name}")
                            with member:
                                actual = hash_stream(member, item.size)
                            if actual["size"] != item.size:
                                raise CacheError(f"TAR member is incomplete: {item.name}")
                            members[item.name] = actual
                except (tarfile.TarError, EOFError) as exc:
                    raise CacheError(f"Retained TAR cannot be read: {spec['path']}: {exc}") from exc
        # Publish only after container() has rechecked all opened files and
        # their current paths. A failed or interrupted scan is never cached.
        self.tar_members[key] = members
        actual = members.get(spec["member"])
        if actual is None:
            raise CacheError(f"TAR member must identify exactly one regular file: {spec['member']}")
        return dict(actual)

    def check(self, entry, output=None):
        expected = entry["original"]
        if (entry["custody"]["kind"] in ("zip-member", "tar-member") and
                entry["match"] == "complete" and output is None):
            offset = entry.get("offset", 0)
            if type(offset) is not int or offset < 0:
                raise CacheError("Range offset must be a nonnegative integer")
            if offset != 0:
                raise CacheError("Only range matching accepts a nonzero offset")
            actual = (self.complete_zip_member(entry["custody"], expected_size=expected["size"])
                      if entry["custody"]["kind"] == "zip-member"
                      else self.complete_tar_member(entry["custody"]))
            if actual["size"] != expected["size"]:
                raise CacheError(f"Retained content size differs for {entry['path']}")
            if not same_bytes(actual, expected):
                raise CacheError(f"Retained bytes differ for {entry['path']}")
            return actual
        with self.source(entry["custody"]) as (stream, full_size):
            if entry["match"] == "complete" and full_size != expected["size"]:
                raise CacheError(f"Retained content size differs for {entry['path']}")
            offset = entry.get("offset", 0)
            if type(offset) is not int or offset < 0:
                raise CacheError("Range offset must be a nonnegative integer")
            if entry["match"] != "range" and offset != 0:
                raise CacheError("Only range matching accepts a nonzero offset")
            if full_size < offset + expected["size"]:
                raise CacheError(f"Retained content is shorter than {entry['path']}")
            if offset:
                stream.seek(offset)
            actual = hash_stream(stream, expected["size"], output)
            if not same_bytes(actual, expected):
                raise CacheError(f"Retained bytes differ for {entry['path']}")
        return actual


def custody_spec(value):
    if not isinstance(value, dict) or value.get("kind") not in ("file", "zip-member", "tar-member", "git-blob"):
        raise CacheError("custody.kind must be file, zip-member, tar-member or git-blob")
    result = {key: value[key] for key in ("kind", "path", "sha256", "size", "reference")}
    result["path"] = str(Path(result["path"]).resolve(strict=True))
    sha = result["sha256"]
    if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise CacheError("Custody requires the retained container's lowercase SHA-256")
    if type(result["size"]) is not int or result["size"] < 0:
        raise CacheError("Custody size must be a nonnegative integer")
    if not isinstance(result["reference"], str) or not result["reference"].strip():
        raise CacheError("Custody requires the existing durable recovery reference")
    if result["kind"] == "git-blob":
        result["object_id"] = git_oid(value.get("object_id"))
    if result["kind"] in ("zip-member", "tar-member"):
        result["member"] = value["member"]
        if not isinstance(result["member"], str) or not result["member"]:
            raise CacheError("Custody requires an exact archive member name")
    return result


def create_git_manifest(inventory, output):
    """Complete explicit blob mappings with measured raw-object size and SHA-256."""
    if (not isinstance(inventory, dict) or inventory.get("version") != VERSION
            or not inventory.get("operation_id") or not inventory.get("entries")):
        raise CacheError("Git inventory requires version 1, operation_id and explicit entries")
    root = Path(inventory["cache_root"]).resolve(strict=True)
    if not root.is_dir():
        raise CacheError("Git inventory cache_root must be a directory")
    result, seen, captured = {**inventory, "cache_root": str(root), "entries": []}, set(), {}
    retained_paths = set()
    with Custody(planning=True) as verifier:
        for item in inventory["entries"]:
            name = relative_name(item["path"])
            if name in seen:
                raise CacheError(f"Duplicate Git inventory path: {name}")
            seen.add(name)
            value = item["custody"]
            if value.get("kind") != "git-blob":
                result["entries"].append({**item, "custody": custody_spec(value)})
                continue
            path = str(Path(value["path"]).resolve(strict=True))
            object_id = git_oid(value.get("object_id"))
            if not isinstance(value.get("reference"), str) or not value["reference"].strip():
                raise CacheError("Git inventory requires the existing durable recovery reference")
            retained_paths.update(verifier.git_roots({"path": path}))
            key = (path, object_id)
            if key not in captured:
                spec = {"kind": "git-blob", "path": path, "object_id": object_id,
                        "size": None, "sha256": None}
                with verifier.git_source(spec) as (stream, size):
                    measured = hash_stream(stream)
                captured[key] = measured
            measured = captured[key]
            for field in ("size", "sha256"):
                if field in value and value[field] != measured[field]:
                    raise CacheError(f"Supplied Git {field} differs from the original object: {name}")
            spec = {"kind": "git-blob", "path": path, "object_id": object_id,
                    "reference": value["reference"], **measured}
            result["entries"].append({**item, "custody": spec})
    output = Path(output).resolve()
    if output in {root / item["path"] for item in result["entries"]}:
        raise CacheError("Save the Git manifest outside its selected source files")
    if any(beneath(output, path) for path in retained_paths):
        raise CacheError("Save the Git manifest outside retained object storage")
    atomic_json(output, result, new=True)
    return {"manifest": str(output), "count": len(result["entries"]),
            "unique_git_blobs": len(captured),
            "unique_git_blob_bytes": sum(item["size"] for item in captured.values())}



def allocation_unit(path):
    """Filesystem fragment size is an estimate for new small-file allocation."""
    try:
        value = os.statvfs(path)
        return max(512, value.f_frsize or value.f_bsize)
    except OSError:
        return 4096


def rounded_allocation(size, unit):
    return ((size + unit - 1) // unit) * unit if size else 0


def metadata_storage(plan_path):
    rows = []
    for role, path in (("plan", Path(plan_path)), ("state", state_path(plan_path)),
                       ("progress", progress_path(plan_path))):
        try:
            value = path.lstat()
        except FileNotFoundError:
            rows.append({"role": role, "path": str(path), "present": False})
            continue
        rows.append({"role": role, "path": str(path), "present": True,
                     "device": value.st_dev, "inode": value.st_ino,
                     "size": value.st_size, "allocated_bytes": value.st_blocks * 512,
                     "links": value.st_nlink})
    seen = set()
    total = 0
    for row in rows:
        key = (row.get("device"), row.get("inode"))
        if row["present"] and key not in seen:
            seen.add(key)
            total += row["allocated_bytes"]
    return {"files": rows, "unique_path_inode_allocated_bytes": total,
            "allocation_unit_bytes": allocation_unit(Path(plan_path).parent)}


def recorded_retirement_allocation(state):
    totals = {"known_last_link_allocated_bytes_unlinked": 0,
              "known_original_names_unlinked": 0,
              "known_marker_allocated_bytes_created": 0,
              "known_marker_inodes_created": 0}
    unknown = 0
    for saved in state.get("items", {}).values():
        measured = saved.get("physical_accounting")
        if not isinstance(measured, dict) or measured.get("version") != 1:
            unknown += bool(saved.get("retired_once"))
            continue
        unknown += bool(measured.get("earlier_history_unknown"))
        for key in totals:
            value = measured.get(key, 0)
            if type(value) is int and value >= 0:
                totals[key] += value
    return {**totals, "entries_with_unknown_earlier_history": unknown}


def retirement_allocation(plan, plan_path, *, observations=None, state=None):
    """Read-only, conditional physical projection; never an execution gate."""
    if plan.get("strategy", "retire") != "retire":
        return None
    stamp = now()
    current = {row["path"]: row for row in observations} if observations is not None else None
    grouped, excluded, originals, retained_markers = {}, [], [], {}
    fallback_unit = allocation_unit(plan["cache_root"])
    path_allocated = logical = 0
    marker_bytes = marker_allocated = 0
    for entry in plan["entries"]:
        row = current.get(entry["path"], {}) if current is not None else {
            **entry["observed"], "state": "original", "size": entry["original"]["size"]}
        kind = row.get("state")
        ident = row.get("identity")
        if kind == "retired":
            if isinstance(ident, (list, tuple)) and len(ident) >= 2:
                retained_markers[tuple(ident[:2])] = row.get("allocated_bytes", 0)
            continue
        if kind not in ("original", "resurrected"):
            excluded.append({"path": entry["path"], "state": kind or "unobserved"})
            continue
        logical += entry["original"]["size"]
        path_allocated += row.get("allocated_bytes", 0)
        unit = row.get("allocation_unit_bytes") or entry["observed"].get("allocation_unit_bytes") or fallback_unit
        marker = marker_for(plan, entry)
        # Use the maximum timestamp width emitted by datetime.isoformat().
        marker["retired_at"] = "9999-12-31T23:59:59.999999+00:00"
        serialized = len(encoded(marker))
        cost = rounded_allocation(serialized, unit)
        marker_bytes += serialized
        marker_allocated += cost
        if not isinstance(ident, (list, tuple)) or len(ident) < 5:
            excluded.append({"path": entry["path"], "state": "inode_observation_unavailable"})
            originals.append((entry, None, cost))
            continue
        key = tuple(ident[:2])
        group = grouped.setdefault(key, {"device": key[0], "inode": key[1], "paths": [],
                                        "samples": [], "runtime_consumers": []})
        group["paths"].append(entry["path"])
        group["samples"].append({"identity": list(ident), "links": row.get("links"),
                                 "allocated_bytes": row.get("allocated_bytes")})
        group["runtime_consumers"].extend(row.get("runtime_use", {}).get("consumers", []))
        originals.append((entry, key, cost))
    groups = []
    eligible = {}
    retained = unique = release = 0
    for key, group in grouped.items():
        samples = group.pop("samples")
        links = {sample["links"] for sample in samples}
        allocations = {sample["allocated_bytes"] for sample in samples}
        stable = (len(links) == len(allocations) == 1 and
                  len({tuple(sample["identity"]) for sample in samples}) == 1 and
                  all(type(sample["links"]) is int and sample["links"] > 0 and
                      type(sample["allocated_bytes"]) is int and sample["allocated_bytes"] >= 0
                      for sample in samples))
        count = len(group["paths"])
        observed_links = next(iter(links)) if len(links) == 1 else None
        allocated = max((x for x in allocations if type(x) is int), default=0)
        covered = stable and observed_links == count
        partial = stable and observed_links > count
        if observed_links is not None and observed_links < count:
            stable = covered = False
        reason = ("all_observed_links_selected" if covered else
                  "unselected_hard_links_retain_inode" if partial else
                  "inode_or_link_observations_changed")
        group.update(selected_names=count, observed_link_count=observed_links,
                     unselected_link_count=(observed_links - count if partial else 0 if covered else None),
                     observed_allocated_bytes=allocated, stable_observation=stable,
                     coverage=reason,
                     conditional_last_link_unlink_bytes=allocated if covered else 0)
        unique += allocated
        release += allocated if covered else 0
        retained += allocated if partial else 0
        eligible[key] = allocated if covered else 0
        groups.append(group)
    remaining = {key: len(group["paths"]) for key, group in grouped.items()}
    growth = peak = 0
    for _, key, marker_cost in originals:
        # Rename does not duplicate the original payload. The new marker exists
        # before the staged original is unlinked; its target name is a hard link.
        growth += marker_cost
        peak = max(peak, growth)
        if key is not None:
            remaining[key] -= 1
            if not remaining[key]:
                growth -= eligible[key]
    report = {
        "version": 1, "observed_at": stamp, "strategy": "retire",
        "basis": "current_verified_targets" if current is not None else "frozen_plan_observations",
        "selected_paths": len(plan["entries"]), "remaining_original_paths": len(originals),
        "logical_original_bytes": logical, "path_allocated_bytes": path_allocated,
        "known_unique_inode_allocated_bytes": unique,
        "conditional_last_link_allocated_bytes_unlinked": release,
        "allocated_bytes_retained_by_unselected_links": retained,
        "inode_groups": groups, "unprojected_paths": excluded,
        "inode_observations_complete": not excluded and all(
            group["stable_observation"] for group in groups),
        "marker_storage": {"serialized_bytes_estimate": marker_bytes,
                           "allocated_bytes_estimate": marker_allocated,
                           "new_inode_count": len(originals),
                           "currently_retained_allocated_bytes": sum(retained_markers.values()),
                           "basis": "serialized marker rounded to observed filesystem fragment size"},
        "additional_payload_staging_bytes": 0,
        "conditional_payload_and_marker_net_reduction_bytes": release - marker_allocated,
        "estimated_peak_payload_and_marker_growth_bytes": peak,
        "metadata_storage": metadata_storage(plan_path),
        "notices": [
            "A selected name releases payload allocation only when its original inode loses its final hard link.",
            "Unselected hard-link paths are outside this inventory; their owners and active readers remain unchanged.",
            "Rename into same-filesystem staging adds no second payload copy. A staged marker and its target share one inode.",
            "Journal events, checkpoint replacement, directory metadata and any new custody pins consume additional space.",
            "The checkpoint temporary file coexists with the old state and progress journal; reserve metadata space separately.",
            "Open file descriptors, filesystem extent sharing and concurrent writers can delay or obscure global free-space changes.",
            "This observation does not replace the original runtime-consumer guard or grant retirement of additional paths."
        ]}
    if excluded or any(not group["stable_observation"] for group in groups):
        report["advice"] = "Review unprojected paths and changed inode observations before using the space estimate."
    elif not originals:
        report["advice"] = "No original target remains in this observation; inspect recorded history and retained markers."
    elif release <= marker_allocated:
        report["advice"] = "This selection does not reduce payload plus marker allocation; retain shared copies or select a useful owned subset."
    else:
        report["advice"] = "The selected final links can reduce payload allocation; subtract additional journal and directory costs before planning capacity."
    if state is not None:
        report["recorded_history"] = recorded_retirement_allocation(state)
    return report


def create_plan(manifest, plan_path, *, runtime_consumers_root=None):
    with Custody(planning=True) as verifier:
        return _create_plan(manifest, plan_path, verifier,
                            runtime_consumers_root=runtime_consumers_root)


def _create_plan(manifest, plan_path, verifier, *, runtime_consumers_root=None):
    if manifest.get("version") != VERSION or not manifest.get("operation_id"):
        raise CacheError("Manifest requires version: 1 and an operation_id")
    strategy = manifest.get("strategy", "retire")
    if strategy not in ("retire", "coalesce", "release"):
        raise CacheError("strategy must be retire, coalesce or explicit closed-copy release")
    if strategy == "release":
        ownership = manifest.get("ownership")
        if (not isinstance(ownership, dict) or ownership.get("closed") is not True
                or not isinstance(ownership.get("reference"), str) or not ownership["reference"].strip()):
            raise CacheError("Release needs ownership.closed: true and the existing owner approval reference")
    ownership = manifest.get("ownership", {})
    if strategy == "coalesce":
        if (not isinstance(ownership, dict) or ownership.get("immutable") is not True
                or not isinstance(ownership.get("reference"), str) or not ownership["reference"].strip()):
            raise CacheError("Coalescing needs ownership.immutable: true and the existing ownership reference for both paths")
        shared_inode_contract(ownership)
        if type(manifest.get("refresh_mtime", True)) is not bool:
            raise CacheError("refresh_mtime must be a boolean")
    root = Path(manifest["cache_root"]).resolve(strict=True)
    if not root.is_dir():
        raise CacheError("cache_root must be an existing cloud directory")
    external = None
    if strategy == "release":
        from cache_closed_release import external_journal
        external = external_journal(manifest["journal_directory"], root)
    entries, paths, target_inodes = [], set(), set()
    for item in manifest["entries"]:
        relative = relative_name(item["path"])
        if relative in paths:
            raise CacheError(f"Duplicate cache path: {relative}")
        paths.add(relative)
        with parent_fd(root, relative) as (directory, name):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                actual = inspect_coalesce_fd(fd) if strategy == "coalesce" else inspect_fd(fd)
                target_inodes.add(tuple(actual["identity"][:2]))
            finally:
                os.close(fd)
        match = item.get("match", "complete")
        if match not in ("complete", "prefix", "range") or (match != "complete" and actual["size"] == 0):
            raise CacheError("match must be complete, or prefix/range for a nonempty copy")
        if strategy == "release" and match != "complete":
            raise CacheError("Release only complete owner-closed copies")
        if match == "range":
            offset = item.get("offset")
            if type(offset) is not int or offset < 0:
                raise CacheError("Range matching requires a nonnegative integer offset")
        elif "offset" in item:
            raise CacheError("Use match: range with an offset; complete/prefix matching starts at zero")
        entry = {"id": hashlib.sha256(relative.encode()).hexdigest()[:24], "path": relative,
                 "original": {key: actual[key] for key in ("sha256", "size")},
                 "observed": {**{key: actual[key] for key in ("allocated_bytes", "mode", "links", "identity")},
                              "allocation_unit_bytes": allocation_unit(root / relative)},
                 "match": match, "custody": custody_spec(item["custody"])}
        if match == "range":
            entry["offset"] = offset
        if strategy == "release" and entry["custody"]["kind"] == "git-blob":
            raise CacheError("Keep Git blobs on the existing pinned Git retirement path")
        if strategy == "coalesce":
            if match != "complete" or entry["custody"]["kind"] != "file":
                raise CacheError("Coalescing requires complete regular-file copies; use retire for prefixes, ranges or ZIP members")
            entry["metadata"] = actual["metadata"]
            coalesce_entry_contract({"cache_root": str(root), "ownership": ownership}, entry)
            entry["observed"]["mtime_ns"] = actual["identity"][3]
            with retained_file(entry) as (fd, _, _):
                retained = inspect_coalesce_fd(fd, entry)
                if not same_bytes(retained, entry["custody"]):
                    raise CacheError("Retained-file digest differs from the custody specification")
                if retained["identity"][0] != actual["identity"][0]:
                    raise CacheError("Coalescing requires both files on the same filesystem")
                entry["observed"]["retained_mtime_ns"] = retained["identity"][3]
                entry["observed"]["already_shared"] = retained["identity"][:2] == actual["identity"][:2]
        else:
            verifier.check(entry)
        entries.append(entry)
    if not entries:
        raise CacheError("Manifest has no explicitly selected cache files")
    targets = [root / entry["path"] for entry in entries]
    retained = {Path(entry["custody"]["path"]) for entry in entries}
    if strategy in ("retire", "release"):
        verifier.protect_selected(targets, target_inodes)
        retained.update(Path(path) for path in verifier.files)
    for copy in retained:
        retained_stat = copy.stat()
        if copy in targets or (strategy in ("retire", "release") and
                               (retained_stat.st_dev, retained_stat.st_ino) in target_inodes):
            raise CacheError(f"Retained container is also a selected cache file: {copy}")
    git_entries = [entry for entry in entries if entry["custody"]["kind"] == "git-blob"]
    git_roots = {Path(path) for entry in git_entries for path in verifier.git_roots(entry["custody"])}
    for target in targets:
        if any(beneath(target, backing) or beneath(target.resolve(), backing) for backing in git_roots):
            raise CacheError(f"A selected target is inside retained Git storage: {target}")
    plan_path = Path(plan_path).resolve()
    if strategy == "release" and not beneath(plan_path, external["directory"]):
        raise CacheError("Save the release plan in its selected external recovery directory")
    if (plan_path in targets or plan_path in retained or
            any(beneath(plan_path, backing) for backing in git_roots)):
        raise CacheError("Save the plan outside selected files and retained containers")
    plan_version = (CLOSED_RELEASE_PLAN_VERSION if strategy == "release" else
                    GIT_PLAN_VERSION if git_entries else
                    TAR_PLAN_VERSION if any(entry["custody"]["kind"] == "tar-member" for entry in entries)
                    else RANGE_PLAN_VERSION if any(entry["match"] == "range" for entry in entries)
                    else VERSION)
    plan = {"version": plan_version, "operation_id": str(manifest["operation_id"]),
            "created_at": now(), "cache_root": str(root), "entries": entries}
    if strategy == "release":
        plan.update(strategy=strategy, ownership={"closed": True, "reference": ownership["reference"]},
                    external_journal=external)
    if strategy == "coalesce":
        plan.update(strategy=strategy, ownership={"immutable": True, "reference": ownership["reference"],
                                                  "inode_contract": SHARED_INODE_CONTRACT},
                    refresh_mtime=manifest.get("refresh_mtime", True))
    def publish():
        plan["plan_id"] = digest(plan)
        if any(len(encoded(marker_for(plan, entry))) > MARKER_LIMIT for entry in entries):
            raise CacheError("A recovery marker exceeds the 32 KiB supported size")
        atomic_json(plan_path, plan, new=True)

    if git_entries or strategy == "release":
        from runtime_consumers import RetirementGuard
        consumers = RetirementGuard(runtime_consumers_root)
        plan["runtime_consumers_root"] = str(consumers.root)
        # This is the original registry lock. Pin existing objects, then publish
        # the plan and its directory dependencies before any cache can retire.
        with consumers.hold(plan_path):
            if git_entries:
                verifier.pin_git(entries)
            publish()
            retained_plan = consumers.remember_plan(plan_path, plan, custody_paths=[
                *git_backing_paths(plan),
                *(verifier.files if strategy == "release" else ())])
    else:
        publish()
    return {"plan": str(plan_path), "plan_id": plan["plan_id"], "strategy": strategy, "count": len(entries),
            **({"retained_plan": str(retained_plan)} if strategy == "release" else {}),
            "logical_bytes": sum(entry["original"]["size"] for entry in entries),
            "allocated_bytes_observed": sum(entry["observed"]["allocated_bytes"] for entry in entries),
            **({"physical_allocation": retirement_allocation(plan, plan_path)} if strategy == "retire" else {})}


def load_plan(path):
    plan = read_json(path)
    body = {key: value for key, value in plan.items() if key != "plan_id"}
    if plan.get("version") not in (VERSION, RANGE_PLAN_VERSION, TAR_PLAN_VERSION, GIT_PLAN_VERSION,
                                  CLOSED_RELEASE_PLAN_VERSION) or plan.get("plan_id") != digest(body):
        raise CacheError("Plan format or digest changed; create a new plan from the exact inventory")
    for entry in plan["entries"]:
        relative_name(entry["path"])
    if plan.get("version") == CLOSED_RELEASE_PLAN_VERSION or plan.get("strategy") == "release":
        from cache_closed_release import validate_plan
        validate_plan(plan)
    git_entries = [entry for entry in plan["entries"] if entry["custody"]["kind"] == "git-blob"]
    if git_entries:
        registry = plan.get("runtime_consumers_root")
        if (plan["version"] != GIT_PLAN_VERSION or not isinstance(registry, str)
                or not Path(registry).is_absolute()):
            raise CacheError("Git plans require version 4 and their original consumer registry")
        for entry in git_entries:
            spec = entry["custody"]
            git_oid(spec.get("object_id"))
            backings = spec.get("git_backings")
            if (not isinstance(backings, list) or not backings
                    or not all(isinstance(row, dict) and isinstance(row.get("path"), str)
                               and Path(row["path"]).is_absolute() for row in backings)
                    or spec["path"] not in {row["path"] for row in backings}):
                raise CacheError("Git plan is missing its retained backing directories")
            for row in backings:
                if row.get("pin_ref") != "refs/commons-cache-custody/" + git_oid(row.get("pin_tree")):
                    raise CacheError("Git plan is missing its immutable object-tree pin")
    return plan


def state_path(path):
    return Path(str(path) + ".state.json")


def progress_path(path):
    return Path(str(state_path(path)) + ".events")


def _state_version(path):
    try:
        return identity(state_path(path).stat())
    except FileNotFoundError:
        return None


def _progress_state(path, plan):
    """Read the original checkpoint plus a bounded snapshot of its progress."""
    for _ in range(3):
        version = _state_version(path)
        try:
            from cache_metadata import read_metadata_bytes
            raw = read_metadata_bytes(state_path(path))
        except FileNotFoundError:
            raw = encoded({"plan_id": plan["plan_id"], "items": {}})
        state = json.loads(raw)
        if state.get("plan_id") != plan["plan_id"] or not isinstance(state.get("items"), dict):
            raise CacheError("Journal belongs to a different plan or has invalid items")
        base_sha = hashlib.sha256(raw).hexdigest()
        meta = {"base_sha256": base_sha, "sequence": 0, "offset": 0,
                "identity": None}
        try:
            fd = os.open(progress_path(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            if _state_version(path) == version:
                return state, meta
            continue
        with os.fdopen(fd, "rb") as stream:
            initial = os.fstat(stream.fileno())
            if not stat.S_ISREG(initial.st_mode):
                raise CacheError("Coalescing progress must be a regular file")
            meta["identity"] = identity(initial)
            remaining = initial.st_size

            def line():
                nonlocal remaining
                value = stream.readline(min(CHUNK + 1, remaining))
                remaining -= len(value)
                if len(value) > CHUNK:
                    raise CacheError("Coalescing progress record is too large")
                return value

            header = line()
            if not header.endswith(b"\n"):
                raise CacheError("Coalescing progress has an incomplete header")
            header = json.loads(header)
            if (not isinstance(header, dict) or header.get("version") != 1 or
                    header.get("plan_id") != plan["plan_id"] or
                    header.get("kind") != "coalesce-progress"):
                raise CacheError("Coalescing progress belongs to a different plan")
            matched = header.get("base_sha256") == base_sha
            meta["offset"] = stream.tell()
            allowed = {entry["id"] for entry in plan["entries"]}
            while remaining:
                raw_event = line()
                if not raw_event or not raw_event.endswith(b"\n"):
                    # An interrupted append never commits a partial final line.
                    # A writer removes only this suffix after reacquiring ownership.
                    break
                event = json.loads(raw_event)
                if (not isinstance(event, dict) or type(event.get("sequence")) is not int or
                        event.get("sequence") != meta["sequence"] + 1):
                    raise CacheError("Coalescing progress sequence is invalid")
                if event.get("kind") == "item":
                    if event.get("entry_id") not in allowed or not isinstance(event.get("value"), dict):
                        raise CacheError("Coalescing progress has an unknown entry")
                    if matched:
                        state["items"][event["entry_id"]] = event["value"]
                elif event.get("kind") == "checkpoint":
                    # The checkpoint was atomically published, but the prior
                    # event file may still exist after an interrupted unlink.
                    if event.get("sha256") == base_sha:
                        matched = True
                else:
                    raise CacheError("Coalescing progress record kind is invalid")
                meta["sequence"] = event["sequence"]
                meta["offset"] = stream.tell()
            if not matched:
                if _state_version(path) != version:
                    continue
                raise CacheError("State checkpoint changed outside its retained progress journal")
        if _state_version(path) == version:
            return state, meta
    raise CacheError("State checkpoint is changing; read this original operation again")


def load_state(path, plan):
    return _progress_state(path, plan)[0]


class CoalesceProgress(dict):
    """Append each durable phase once; publish the normal state snapshot once."""

    def __init__(self, path, plan):
        state, meta = _progress_state(path, plan)
        super().__init__(state)
        self.path = path
        self.events = progress_path(path)
        self.meta = meta
        self.fd = None
        self.broken = False
        self.metrics = {"item_records_written": 0, "progress_bytes_written": 0,
                        "checkpoint_bytes_written": 0, "resumed_progress": meta["identity"] is not None,
                        "peak_progress_allocated_bytes": 0, "checkpoint_allocated_bytes_written": 0}

    def __enter__(self):
        return self

    def _open(self):
        if self.fd is not None:
            return
        if self.meta["identity"] is None:
            header = {"version": 1, "kind": "coalesce-progress",
                      "plan_id": self["plan_id"], "base_sha256": self.meta["base_sha256"]}
            data = (json.dumps(header, sort_keys=True, separators=(",", ":")) + "\n").encode()
            atomic_bytes(self.events, data, new=True)
            self.metrics["progress_bytes_written"] += len(data)
            self.meta["identity"] = identity(self.events.stat())
            self.meta["offset"] = len(data)
        fd = os.open(self.events, os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if identity(os.fstat(fd)) != self.meta["identity"]:
                raise CacheError("Coalescing progress changed before this writer acquired it")
            if os.fstat(fd).st_size != self.meta["offset"]:
                os.ftruncate(fd, self.meta["offset"])
                os.fsync(fd)
            self.fd = fd
        except BaseException:
            os.close(fd)
            raise

    def _append(self, event):
        if self.broken:
            raise CacheError("Preserve the interrupted progress file and resume this operation")
        self._open()
        event = {**event, "sequence": self.meta["sequence"] + 1}
        data = (json.dumps(event, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")) + "\n").encode()
        if len(data) > CHUNK:
            raise CacheError("Coalescing progress record is too large")
        before = self.meta["offset"]
        actual = os.fstat(self.fd)
        if (actual.st_size != before or
                tuple(identity(self.events.stat())[:2]) != tuple(identity(actual)[:2])):
            raise CacheError("Coalescing progress changed during the original operation")
        try:
            pending = memoryview(data)
            while pending:
                written = os.write(self.fd, pending)
                if not written:
                    raise OSError("Coalescing progress append made no progress")
                pending = pending[written:]
            os.fsync(self.fd)
        except BaseException:
            try:
                os.ftruncate(self.fd, before)
                os.fsync(self.fd)
            except OSError:
                self.broken = True
            raise
        self.metrics["peak_progress_allocated_bytes"] = max(
            self.metrics["peak_progress_allocated_bytes"], os.fstat(self.fd).st_blocks * 512)
        self.meta["offset"] = before + len(data)
        self.meta["sequence"] = event["sequence"]
        self.metrics["progress_bytes_written"] += len(data)
        self.metrics["item_records_written"] += event["kind"] == "item"

    def record(self, entry, fields):
        value = {**self["items"].get(entry["id"], {}), **fields, "updated_at": now()}
        # Preserve the original in-memory accounting if a post-unlink save fails.
        self["items"][entry["id"]] = value
        self._append({"kind": "item", "entry_id": entry["id"], "value": value})

    def checkpoint(self):
        if self.fd is None and self.meta["identity"] is None:
            return
        data = encoded(self)
        self._append({"kind": "checkpoint", "sha256": hashlib.sha256(data).hexdigest()})
        from cache_metadata import write_metadata_bytes
        write_metadata_bytes(state_path(self.path), data, atomic_bytes)
        self.metrics["checkpoint_bytes_written"] += len(data)
        # This new checkpoint inode was fully allocated before atomic replacement;
        # it coexisted with the old checkpoint and the retained progress journal.
        self.metrics["checkpoint_allocated_bytes_written"] += state_path(self.path).stat().st_blocks * 512
        # Either the old checkpoint + events or the new checkpoint + its saved
        # checksum is readable at every interruption point.
        self.events.unlink()
        sync_dir(self.events.parent)

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None:
                self.checkpoint()
        finally:
            if self.fd is not None:
                os.close(self.fd)


def record(path, journal, entry, **fields):
    if isinstance(journal, CoalesceProgress):
        journal.record(entry, fields)
    else:
        journal["items"].setdefault(entry["id"], {}).update(fields, updated_at=now())
        atomic_json(state_path(path), journal)


@contextlib.contextmanager
def workspace(plan, work_dir=None):
    work = Path(work_dir or (Path(tempfile.gettempdir()) / f"commons-cloud-cache-{os.getuid()}"))
    if any(beneath(work.resolve(), backing) for backing in git_backing_paths(plan)):
        raise CacheError("Keep staging outside retained Git storage")
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    if work.is_symlink() or not work.is_dir():
        raise CacheError("work-dir must be a real private directory")
    work = work.resolve()
    if work.stat().st_dev != Path(plan["cache_root"]).stat().st_dev:
        raise CacheError("work-dir must share cache_root's filesystem for atomic moves; choose a cloud directory outside the synchronized cache")
    root_id = hashlib.sha256(plan["cache_root"].encode()).hexdigest()
    fd = os.open(work / (root_id + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CacheError("Another cache operation is using this root; inspect its current outcome before retrying")
        stage = work / plan["plan_id"]
        stage.mkdir(mode=0o700, exist_ok=True)
        yield stage
    finally:
        os.close(fd)


def remove_verified(path, expected, *, file_use=False, on_file_use=None):
    """Discard retained bytes under the original optional kernel exclusion."""
    with selected_file(path, require_unused=file_use) as held:
        fd = held.fd
        actual = inspect_fd(fd)
        if not same_bytes(actual, expected):
            raise CacheError(f"Staged bytes changed; preserved for recovery at {path}")
        before = os.fstat(fd)
        if (identity(before) != tuple(actual["identity"]) or
                identity(os.stat(path, follow_symlinks=False)) != identity(before)):
            raise CacheError(f"Staging path changed; preserved for recovery at {path}")
        if file_use and on_file_use is not None:
            on_file_use(held.observation())
        held.change("unlink_original", lambda: Path(path).unlink())
        after = os.fstat(fd)
        # The original descriptor observes the actual remaining hard links.
        released = before.st_blocks * 512 if after.st_nlink == 0 else 0
        sync_dir(Path(path).parent)
        return {"last_link_allocated_bytes_unlinked": released,
                "original_names_unlinked": 1,
                "device": before.st_dev, "inode": before.st_ino,
                "observed_links": before.st_nlink, "links_after_unlink": after.st_nlink,
                "observed_allocated_bytes": before.st_blocks * 512,
                **({"file_use": held.observation()} if file_use else {})}


def link_to_target(source, plan, entry):
    with parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
        os.link(source, name, dst_dir_fd=directory, follow_symlinks=False)
        os.fsync(directory)


def retire_entry(path, plan, state, entry, stage, verifier, *, file_use=False):
    saved = state["items"].get(entry["id"], {})
    old = saved.get("physical_accounting")
    old = old if isinstance(old, dict) and old.get("version") == 1 else {}
    measured = {"known_last_link_allocated_bytes_unlinked": 0,
                "known_original_names_unlinked": 0,
                "known_marker_allocated_bytes_created": 0,
                "known_marker_inodes_created": 0}
    if any(type(old.get(key, 0)) is not int or old.get(key, 0) < 0 for key in measured):
        raise CacheError("Retirement allocation history is invalid; preserve the original plan and state")

    prior_interval_unknown = False
    file_use_observations = []

    def accounting():
        return {"version": 1,
                "earlier_history_unknown": bool(old.get("earlier_history_unknown") or prior_interval_unknown or
                                                (not old and saved.get("retired_once"))),
                **{key: old.get(key, 0) + value for key, value in measured.items()}}

    def observe_file_use(observation):
        file_use_observations.append(observation)
        record(path, state, entry, file_use=observation,
               physical_accounting=accounting())

    def remove_original(value):
        observed = remove_verified(value, entry["original"], file_use=file_use,
                                   on_file_use=observe_file_use if file_use else None)
        measured["known_last_link_allocated_bytes_unlinked"] += observed["last_link_allocated_bytes_unlinked"]
        measured["known_original_names_unlinked"] += observed["original_names_unlinked"]
        if file_use:
            observe_file_use(observed["file_use"])

    staged = Path(saved.get("staged_path") or (stage / (entry["id"] + ".data")))
    if staged.parent != stage:
        raise CacheError(f"Resume with the original work-dir; staged bytes are at {staged}")
    current = inspect_target(plan, entry)
    # A missing stage after an incomplete durable retirement may mean unlink
    # finished before its accounting record (including a failed directory sync).
    # Preserve lower bounds; do not reconstruct that unlink from the plan.
    prior_interval_unknown = bool(
        (saved.get("retired_once") and saved.get("phase") != "complete" and not staged.exists()) or
        (current["state"] == "retired" and
         (not old or saved.get("phase") not in ("marker_saved", "complete"))))
    if staged.exists():
        if not same_bytes(snapshot(staged), entry["original"]):
            if current["state"] == "missing":
                link_to_target(staged, plan, entry)
                staged.unlink()
                sync_dir(stage)
                record(path, state, entry, state="changed", phase="changed_bytes_restored")
            raise CacheError(f"Staged content differs from the plan; its bytes were preserved: {entry['path']}")
        if current["state"] in ("retired", "original"):
            remove_original(staged)
        elif current["state"] != "missing":
            raise CacheError(f"New target bytes and the original staging copy both preserved: {entry['path']} ; {staged}")
    if current["state"] == "retired":
        record(path, state, entry, state="retired", phase="complete", retired_once=True,
               physical_accounting=accounting())
        return {"path": entry["path"], "state": "retired", "action": "already_retired",
                "physical_accounting_this_call": measured,
                **({"file_use": file_use_observations} if file_use else {})}
    if current["state"] not in ("original", "missing"):
        raise CacheError(f"Cache bytes changed since planning; preserved: {entry['path']}")
    record(path, state, entry, state="retiring", phase="prepared", staged_path=str(staged),
           physical_accounting=accounting())
    if current["state"] == "original":
        with parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
            if file_use:
                target = Path(plan["cache_root"]) / entry["path"]
                with selected_file(name, dir_fd=directory, display_path=target,
                                   require_unused=True) as held:
                    selected = inspect_fd(held.fd)
                    if (not same_bytes(selected, entry["original"]) or
                            identity(os.fstat(held.fd)) != tuple(selected["identity"]) or
                            identity(os.stat(name, dir_fd=directory, follow_symlinks=False))
                            != tuple(selected["identity"])):
                        raise CacheError(f"Original bytes changed before guarded staging: {entry['path']}")
                    observe_file_use(held.observation())
                    held.change("stage_original",
                                lambda: os.rename(name, staged, src_dir_fd=directory))
                    observe_file_use(held.observation())
            else:
                os.rename(name, staged, src_dir_fd=directory)
            os.fsync(directory)
        sync_dir(stage)
        if not same_bytes(snapshot(staged), entry["original"]):
            try:
                link_to_target(staged, plan, entry)
            except FileExistsError:
                pass
            else:
                staged.unlink()
                sync_dir(stage)
            raise CacheError(f"Cache changed during the move; changed bytes preserved at target or {staged}")
    marker = stage / (entry["id"] + ".marker")
    atomic_json(marker, marker_for(plan, entry))
    marker_stat = marker.stat(follow_symlinks=False)
    measured["known_marker_allocated_bytes_created"] += marker_stat.st_blocks * 512
    measured["known_marker_inodes_created"] += 1
    try:
        link_to_target(marker, plan, entry)
    except FileExistsError:
        if inspect_target(plan, entry)["state"] != "retired":
            raise CacheError(f"A new target appeared; it and staged original bytes were preserved: {entry['path']}")
    finally:
        marker.unlink(missing_ok=True)
    record(path, state, entry, state="retired", phase="marker_saved", retired_once=True,
           physical_accounting=accounting())
    if staged.exists():
        remove_original(staged)
    record(path, state, entry, state="retired", phase="complete", retired_once=True,
           physical_accounting=accounting())
    observed = inspect_target(plan, entry)
    outcome = "resurrected" if observed["state"] == "original" else observed["state"]
    return {"path": entry["path"], "state": outcome, "action": "marker_written",
            "original_bytes": entry["original"]["size"],
            "source_state": current["state"], "current_bytes": observed.get("size"),
            "physical_accounting_this_call": measured,
            **({"file_use": file_use_observations} if file_use else {})}

def retirement_guard(plan, runtime_consumers_root=None):
    from runtime_consumers import RetirementGuard
    frozen = plan.get("runtime_consumers_root")
    consumers = RetirementGuard(runtime_consumers_root if runtime_consumers_root is not None else frozen)
    if frozen is not None and consumers.root.resolve() != Path(frozen).resolve():
        raise CacheError("Use the Git plan\'s original runtime consumer registry")
    return consumers


def resolved_plan(plan_path, runtime_consumers_root=None):
    """Resolve the original CLI path to its retained plan and journal."""
    from runtime_consumers import RetirementGuard
    try:
        plan = load_plan(plan_path)
    except FileNotFoundError:
        consumers = RetirementGuard(runtime_consumers_root)
        path, plan = consumers.resolve_plan(plan_path)
        # Preserve a Git plan's exact original registry selection.
        consumers = retirement_guard(plan, str(consumers.root))
        return path, plan, consumers
    consumers = retirement_guard(plan, runtime_consumers_root)
    path, plan = consumers.resolve_plan(plan_path, plan)
    return path, plan, consumers


def retire(plan_path, *, work_dir=None, runtime_consumers_root=None, file_use=False):
    # Resolve/hold already hydrated external containers before root/plan/registry
    # locks. This never performs a network operation or changes the frozen plan.
    from native_library_backing import hold_plan_custody
    with hold_plan_custody(plan_path, runtime_consumers_root=runtime_consumers_root) as bound, \
            Custody(custody_files=bound["custody_files"]) as verifier:
        result = _retire(plan_path, work_dir=work_dir, runtime_consumers_root=runtime_consumers_root,
                         verifier=verifier, file_use=file_use)
        if bound["library_custody"]:
            result["library_custody"] = bound["library_custody"]
        return result


def _retire(plan_path, *, work_dir=None, runtime_consumers_root=None, verifier, file_use=False):
    plan_path, plan, consumers = resolved_plan(plan_path, runtime_consumers_root)
    if plan.get("strategy", "retire") != "retire":
        raise CacheError("This plan preserves file paths; run coalesce, not retire")
    results = []
    backing_paths = git_backing_paths(plan)
    targets = [Path(plan["cache_root"]) / entry["path"] for entry in plan["entries"]]
    target_inodes = set()
    for target in targets:
        try:
            target_inodes.add(identity(target.lstat())[:2])
        except FileNotFoundError:
            pass
    verifier.protect_selected(targets, target_inodes)
    before = shutil.disk_usage(plan["cache_root"]).free
    disk_before = disk_space(plan["cache_root"])
    metadata_before = metadata_storage(plan_path)
    with workspace(plan, work_dir) as stage, consumers.plan_journal(
            plan_path, plan, custody_paths=backing_paths) as retained_path, \
            CoalesceProgress(retained_path, plan) as state:
        plan_path = retained_path
        accounting_before = recorded_retirement_allocation(state)
        for entry in plan["entries"]:
            try:
                # Read large retained containers before taking the registry
                # lock. Registration and the actual path mutation serialize.
                verifier.check(entry)
                target = Path(plan["cache_root"]) / entry["path"]
                with consumers.hold(target) as usage:
                    if usage["consumers"]:
                        result = {"path": entry["path"], "state": "in_use",
                                  "consumers": usage["consumers"],
                                  "runtime_consumers_root": usage["registry_root"]}
                        record(plan_path, state, entry, state="in_use")
                    else:
                        result = retire_entry(plan_path, plan, state, entry, stage, verifier, file_use=file_use)
            except (OSError, ValueError, CacheError, zipfile.BadZipFile) as exc:
                file_use_error = getattr(exc, "file_use", None)
                result = {"path": entry["path"], "state": "preserved", "error": str(exc),
                          **({"file_use": file_use_error} if file_use_error else {})}
                try:
                    record(plan_path, state, entry, state="preserved", error=str(exc),
                           **({"file_use": file_use_error} if file_use_error else {}))
                except OSError as error:
                    result["journal_error"] = str(error)
            results.append(result)
    accounting_after = recorded_retirement_allocation(state)
    return {"ok": all(item["state"] == "retired" for item in results),
            "plan_id": plan["plan_id"], "retained_plan": str(plan_path), "entries": results,
            "free_bytes_before": before, "free_bytes_after": shutil.disk_usage(plan["cache_root"]).free,
            "disk_before": disk_before, "disk_after": disk_space(plan["cache_root"]),
            "journal": state.metrics,
            "physical_accounting": {
                "version": 1,
                "recorded_this_call": {key: accounting_after[key] - accounting_before[key]
                                       for key in accounting_after if key.startswith("known_")},
                "recorded_history": accounting_after,
                "metadata_before": metadata_before, "metadata_after": metadata_storage(plan_path),
                "progress_peak_allocated_bytes": state.metrics["peak_progress_allocated_bytes"],
                "checkpoint_new_inode_allocated_bytes": state.metrics["checkpoint_allocated_bytes_written"],
                "meaning": "Measured checked-inode unlink and marker allocation; not a guaranteed global free-space delta.",
                "interruption": "Unrecorded work after process or storage failure is unknown; an existing marker never reconstructs a release count from the old plan."
            }}


def disk_space(root):
    observed = os.statvfs(root)
    return {"available_bytes": observed.f_bavail * observed.f_frsize,
            "free_including_reserved_bytes": observed.f_bfree * observed.f_frsize}


def coalesce_view(plan, entry, current, saved):
    try:
        coalesce_entry_contract(plan, entry)
        current["coalesce_eligible"] = True
    except CacheError as exc:
        current.update(coalesce_eligible=False, coalesce_error=str(exc))
    if current["state"] == "original":
        with retained_file(entry) as (fd, _, _):
            retained = os.fstat(fd)
            shared = current["identity"][:2] == [retained.st_dev, retained.st_ino]
        current["shared_inode"] = shared
        current["state"] = ("coalesced" if shared else
                            "duplicate_returned" if saved.get("coalesced_once") else "duplicate")
    return current


def coalesce_entry(path, plan, state, entry, stage, *, inode_contract=None):
    coalesce_entry_contract(plan, entry, inode_contract=inode_contract)
    saved = state["items"].get(entry["id"], {})
    staged = Path(saved.get("staged_path") or (stage / (entry["id"] + ".shared")))
    if staged.parent != stage:
        raise CacheError(f"Resume with the original work-dir; preserved bytes are at {staged}")
    released = 0
    with retained_file(entry) as (source_fd, source_dir, source_name):
        retained = inspect_coalesce_fd(source_fd, entry)
        if not same_bytes(retained, entry["custody"]):
            raise CacheError("Retained-file content no longer matches custody")
        source_inode = tuple(retained["identity"][:2])
        with parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                original = inspect_coalesce_fd(fd, entry)
                if original["identity"][0] != source_inode[0]:
                    raise CacheError("Coalescing requires the same filesystem")
                if (saved.get("state") == "coalesced" and saved.get("phase") == "complete" and
                        saved.get("coalesced_once") and not os.path.lexists(staged) and
                        tuple(original["identity"][:2]) == source_inode):
                    # Full content/metadata were just read through both original
                    # descriptors. A completed shared pair needs no new timestamp
                    # or durable phase; preserve its original completion record.
                    inspect_coalesce_fd(source_fd, entry)
                    if (inode_at(source_dir, source_name) != source_inode or
                            inode_at(directory, name) != source_inode or
                            identity(os.fstat(fd)) != tuple(original["identity"])):
                        raise CacheError("Completed shared paths changed during inspection")
                    return {"path": entry["path"], "state": "coalesced", "action": "already_shared",
                            "shared_inode": True, "original_bytes": entry["original"]["size"],
                            "last_link_allocated_bytes_unlinked": 0, "refreshed_mtime_ns": None}
                record(path, state, entry, state="coalescing", phase="prepared", staged_path=str(staged),
                       attempt_unlinked_bytes=0, error=None)
                # A surviving stage is either the candidate before the exchange,
                # or the replaced original after it. Inspect bytes, not just phase.
                if staged.exists():
                    stage_fd = os.open(staged, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    try:
                        leftover = inspect_coalesce_fd(stage_fd, entry)
                    finally:
                        os.close(stage_fd)
                    target_shared = tuple(original["identity"][:2]) == source_inode
                    if tuple(leftover["identity"][:2]) != source_inode or target_shared:
                        inspect_coalesce_fd(source_fd, entry)
                        if inode_at(source_dir, source_name) != source_inode or inspect_target(plan, entry)["state"] != "original":
                            raise CacheError("Current or retained path changed; staged original preserved")
                        released += discard_coalesce_stage(staged, entry)
                        record(path, state, entry, attempt_unlinked_bytes=released)
                refreshed = None
                if plan.get("refresh_mtime", True):
                    source_stat, target_stat = os.fstat(source_fd), os.fstat(fd)
                    refreshed = max(time.time_ns(), source_stat.st_mtime_ns, target_stat.st_mtime_ns) + 1
                    os.utime(source_fd, ns=(source_stat.st_atime_ns, refreshed))
                    os.fsync(source_fd)
                if inode_at(source_dir, source_name) != source_inode:
                    raise CacheError("Retained path was replaced; staged bytes preserved")
                if inode_at(directory, name) != source_inode:
                    if not staged.exists():
                        os.link(source_name, staged, src_dir_fd=source_dir, follow_symlinks=False)
                        sync_dir(stage)
                    if tuple(snapshot(staged)["identity"][:2]) != source_inode:
                        raise CacheError(f"Candidate no longer shares the retained inode: {staged}")
                    # Re-read after preparation: an external mirror can replace or
                    # rewrite the selected path while the plan journal is saved.
                    fresh_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
                    try:
                        fresh = inspect_coalesce_fd(fresh_fd, entry)
                        if list(identity(os.stat(name, dir_fd=directory, follow_symlinks=False))) != fresh["identity"]:
                            raise CacheError("Target changed during preparation; candidate preserved")
                    finally:
                        os.close(fresh_fd)
                    record(path, state, entry, phase="candidate_linked", replaced_identity=fresh["identity"])
                    exchange_file(staged, directory, name)
                    action = "shared_path_saved"
                else:
                    action = "already_shared"
                # Keep the replaced original until both current bytes and the
                # retained path still agree. Unexpected staged content is retained.
                inspect_coalesce_fd(source_fd, entry)
                if inode_at(source_dir, source_name) != source_inode:
                    raise CacheError("Retained path changed after exchange; original preserved")
                current = inspect_target(plan, entry)
                if current["state"] != "original":
                    raise CacheError(f"Target changed after exchange; original preserved at {staged}")
                record(path, state, entry, phase=action, coalesced_once=True,
                       shared_inode=list(source_inode), refreshed_mtime_ns=refreshed)
                if staged.exists():
                    released += discard_coalesce_stage(staged, entry)
                record(path, state, entry, state="coalesced", phase="complete", coalesced_once=True,
                       last_link_allocated_bytes_unlinked=released, attempt_unlinked_bytes=released)
            finally:
                os.close(fd)
    current = coalesce_view(plan, entry, inspect_target(plan, entry), state["items"][entry["id"]])
    return {"path": entry["path"], "state": current["state"], "action": action,
            "shared_inode": current.get("shared_inode", False), "original_bytes": entry["original"]["size"],
            "last_link_allocated_bytes_unlinked": released, "refreshed_mtime_ns": refreshed}


def coalesce(plan_path, *, work_dir=None, inode_contract=None):
    """Join explicit immutable complete copies while preserving every target path."""
    plan = load_plan(plan_path)
    if plan.get("strategy") != "coalesce":
        raise CacheError("Create a coalesce plan with the exact immutable file inventory")
    # Preflight every entry before a work directory, journal, timestamp or hard link
    # can change. This also prevents replay of old plans over restored private files.
    for entry in plan["entries"]:
        coalesce_entry_contract(plan, entry, inode_contract=inode_contract)
    before, results = disk_space(plan["cache_root"]), []
    with workspace(plan, work_dir) as stage, CoalesceProgress(plan_path, plan) as state:
        for entry in plan["entries"]:
            state["items"].setdefault(entry["id"], {})["attempt_unlinked_bytes"] = 0
            try:
                result = coalesce_entry(plan_path, plan, state, entry, stage,
                                        inode_contract=inode_contract)
            except (OSError, ValueError, CacheError) as exc:
                result = {"path": entry["path"], "state": "preserved", "error": str(exc),
                          "last_link_allocated_bytes_unlinked": state["items"].get(entry["id"], {}).get("attempt_unlinked_bytes", 0)}
                try:
                    record(plan_path, state, entry, state="preserved", error=str(exc))
                except OSError as error:
                    result["journal_error"] = str(error)
            results.append(result)
    return {"ok": all(item["state"] == "coalesced" for item in results), "strategy": "coalesce",
            "plan_id": plan["plan_id"], "entries": results,
            "last_link_allocated_bytes_unlinked": sum(item.get("last_link_allocated_bytes_unlinked", 0) for item in results),
            "disk_before": before, "disk_after": disk_space(plan["cache_root"]),
            "journal": state.metrics, "inode_contract": SHARED_INODE_CONTRACT,
            "legacy_contract_acknowledged": "inode_contract" not in plan.get("ownership", {})}


def status(plan_path, *, verify_custody=False, runtime_consumers_root=None):
    from native_library_backing import backing_status, hold_plan_custody
    if not verify_custody:
        with Custody() as verifier:
            result = _status(plan_path, verify_custody=False,
                             runtime_consumers_root=runtime_consumers_root, verifier=verifier)
        external = backing_status(plan_path, runtime_consumers_root=runtime_consumers_root)
        if external:
            result["library_custody"] = external
        return result
    with hold_plan_custody(plan_path, require_warm=False,
                           runtime_consumers_root=runtime_consumers_root) as bound, \
            Custody(custody_files=bound["custody_files"]) as verifier:
        return _status(plan_path, verify_custody=True,
                       runtime_consumers_root=runtime_consumers_root, verifier=verifier,
                       library_custody=bound["library_custody"])


def _status(plan_path, *, verify_custody=False, runtime_consumers_root=None, verifier, library_custody=None):
    plan_path, plan, consumers = resolved_plan(plan_path, runtime_consumers_root)
    state = load_state(plan_path, plan)
    results = []
    for entry in plan["entries"]:
        saved = state["items"].get(entry["id"], {})
        try:
            current = inspect_target(plan, entry)
            if plan.get("strategy") == "coalesce":
                current = coalesce_view(plan, entry, current, saved)
            elif plan.get("strategy") == "release":
                from cache_closed_release import view
                current = view(entry, current, saved)
            elif current["state"] == "original" and saved.get("retired_once"):
                current["state"] = "resurrected"
            if verify_custody:
                external = (library_custody or {}).get(entry["custody"]["path"])
                if external and external["state"] == "materialization_required":
                    current["custody"] = "materialization_required"
                    current["library_custody"] = external
                else:
                    verifier.check(entry)
                    current["custody"] = "verified"
                    current.update(verifier.recovery_details(entry["custody"]))
                    if external:
                        current["library_custody"] = external
        except (OSError, ValueError, CacheError, zipfile.BadZipFile) as exc:
            current = {"state": "preserved", "error": str(exc)}
        staged = saved.get("staged_path")
        if staged and Path(staged).exists():
            current["staged_path"] = staged
            current["staged_bytes"] = Path(staged).stat().st_size
            current["resume"] = plan.get("strategy", "retire") + " with this plan and its original work-dir"
        results.append({"path": entry["path"], **current,
                        **({"file_use": saved["file_use"]} if isinstance(saved.get("file_use"), dict) else {})})
    usage = consumers.inspect_many(Path(plan["cache_root"]) / entry["path"] for entry in plan["entries"])
    for result, report in zip(results, usage.pop("reports")):
        result["runtime_use"] = report
    return {"ok": all(item["state"] in ("original", "retired", "duplicate", "coalesced", "released")
                         and not item.get("staged_path")
                         and item.get("custody") != "materialization_required" for item in results),
            "plan_id": plan["plan_id"], "retained_plan": str(plan_path), "entries": results,
            "runtime_use_observation": usage,
            "free_bytes": shutil.disk_usage(plan["cache_root"]).free,
            "disk": disk_space(plan["cache_root"]),
            **({"physical_allocation": retirement_allocation(plan, plan_path, observations=results, state=state)}
               if plan.get("strategy", "retire") == "retire" else {})}


def restore(plan_path, destination, *, entries=None, custody_files=None):
    """Materialize exact original bytes in a new directory; never replace data."""
    # Explicit relocation keeps its existing full-container/member validation.
    # External Library pointers require already hydrated bytes; no implicit I/O.
    from native_library_backing import hold_plan_custody
    with hold_plan_custody(plan_path, entries=entries, custody_files=custody_files) as bound, \
            Custody(require_pins=False) as verifier:
        return _restore(plan_path, destination, entries=entries,
                        custody_files=bound["custody_files"], verifier=verifier)


def _restore(plan_path, destination, *, entries=None, custody_files=None, verifier):
    try:
        plan = load_plan(plan_path)
    except FileNotFoundError:
        plan_path, plan, _ = resolved_plan(plan_path)
    known_custody = {entry["custody"]["path"] for entry in plan["entries"]}
    relocated = {}
    pairs = custody_files.items() if isinstance(custody_files, dict) else (custody_files or [])
    for original_path, local_path in pairs:
        if original_path not in known_custody:
            raise CacheError(f"Custody path is absent from the frozen plan: {original_path}")
        resolved = str(Path(local_path).resolve(strict=True))
        if original_path in relocated and relocated[original_path] != resolved:
            raise CacheError(f"Multiple recovery locations supplied for custody: {original_path}")
        relocated[original_path] = resolved
    destination = Path(destination).resolve()
    if destination == Path(plan["cache_root"]):
        raise CacheError("Choose a recovery directory distinct from the retired cache_root")
    if any(beneath(destination, relocated.get(path, path)) for path in git_backing_paths(plan)):
        raise CacheError("Keep restored files outside retained Git storage")
    selected = set(entries or [entry["path"] for entry in plan["entries"]])
    unknown = selected - {entry["path"] for entry in plan["entries"]}
    if unknown:
        raise CacheError(f"Paths are absent from the frozen plan: {sorted(unknown)}")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    results = []
    for entry in plan["entries"]:
        if entry["path"] not in selected:
            continue
        spec = entry["custody"]
        relocated_spec = {**spec, "path": relocated.get(spec["path"], spec["path"])}
        if spec["kind"] == "git-blob":
            relocated_spec["git_backings"] = [{**row, "path": relocated.get(row["path"], row["path"])}
                                             for row in spec["git_backings"]]
        source_entry = {**entry, "custody": relocated_spec}
        temporary = None
        try:
            with parent_fd(destination, entry["path"], create=True) as (directory, name):
                try:
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
                except FileNotFoundError:
                    pass
                else:
                    try:
                        if not same_bytes(inspect_fd(fd), entry["original"]):
                            raise CacheError("Existing recovery destination differs; bytes preserved")
                        if plan.get("strategy") == "coalesce":
                            if stat.S_IMODE(os.fstat(fd).st_mode) != entry["metadata"]["mode"]:
                                raise CacheError("Existing recovery destination mode differs; file preserved")
                            with retained_file(source_entry) as (source_fd, _, _):
                                if identity(os.fstat(fd))[:2] == identity(os.fstat(source_fd))[:2]:
                                    raise CacheError("Recovery destination still shares the retained inode; choose a new directory")
                    finally:
                        os.close(fd)
                    results.append({"path": entry["path"], "state": "restored", "action": "already_present"})
                    continue
                # The temporary file is in this destination directory for an atomic
                # no-replace link. Its name is private and is never a recovery result.
                temporary = ".cache-restore-" + os.urandom(16).hex()
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
                try:
                    with os.fdopen(fd, "wb") as stream:
                        verifier.check(source_entry, output=stream)
                        if plan.get("strategy") == "coalesce":
                            os.fchmod(stream.fileno(), entry["metadata"]["mode"])
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
                    os.fsync(directory)
                finally:
                    os.unlink(temporary, dir_fd=directory)
                    temporary = None
                results.append({"path": entry["path"], "state": "restored", "action": "materialized",
                                **entry["original"], **verifier.recovery_details(source_entry["custody"])})
        except (OSError, ValueError, CacheError, zipfile.BadZipFile) as exc:
            results.append({"path": entry["path"], "state": "preserved", "error": str(exc)})
    return {"ok": all(item["state"] == "restored" for item in results),
            "plan_id": plan["plan_id"], "destination": str(destination), "entries": results,
            **({"custody_files": relocated} if relocated else {})}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    git_inventory = sub.add_parser("git-manifest", help="Measure exact retained Git blob mappings for a normal manifest")
    git_inventory.add_argument("--inventory", required=True)
    git_inventory.add_argument("--output", required=True)
    plan = sub.add_parser("plan", help="Read exact cache/retained bytes and freeze a custody-backed plan")
    plan.add_argument("--manifest", required=True)
    plan.add_argument("--output", required=True)
    plan.add_argument("--runtime-consumers-root", help="same shared consumer index for Git custody dependencies")
    remove = sub.add_parser("retire", help="Replace exact redundant cache files with recovery markers")
    remove.add_argument("--plan", required=True)
    remove.add_argument("--require-unused", action="store_true",
                        help="Require a Linux write lease at each original rename/unlink; preserve conflicts")
    remove.add_argument("--work-dir", help="Private same-filesystem staging outside synchronized cache trees")
    remove.add_argument("--runtime-consumers-root", help="same shared consumer index used by native jobs")
    prepare_closed = sub.add_parser("prepare-release", help="Finish the original closed-copy plan registration without unlinking")
    prepare_closed.add_argument("--plan", required=True)
    prepare_closed.add_argument("--expected-plan", required=True)
    prepare_closed.add_argument("--runtime-consumers-root")
    closed = sub.add_parser("release", help="Unlink reviewed closed copies using their registered external recovery journal")
    closed.add_argument("--plan", required=True)
    closed.add_argument("--expected-plan", required=True)
    closed.add_argument("--runtime-consumers-root", help="the same original consumer registry, never a replacement")
    join = sub.add_parser("coalesce", help="Share immutable identical bytes while retaining every existing file path")
    join.add_argument("--plan", required=True)
    join.add_argument("--work-dir", help="Private same-filesystem staging outside synchronized cache trees")
    join.add_argument("--inode-contract", choices=[SHARED_INODE_CONTRACT],
                      help="Confirm both original readers accept shared inodes for a legacy plan; never overrides exclusions")
    inspect = sub.add_parser("status", help="Show current bytes, retained markers and restored cache copies")
    inspect.add_argument("--plan", required=True)
    inspect.add_argument("--verify-custody", action="store_true")
    inspect.add_argument("--runtime-consumers-root", help="same shared consumer index used by native jobs")
    recover = sub.add_parser("restore", help="Recover exact original files into a new directory")
    recover.add_argument("--plan", required=True)
    recover.add_argument("--destination", required=True)
    recover.add_argument("--entry", action="append", help="Exact planned relative path; repeat to select files")
    recover.add_argument("--custody-file", nargs=2, action="append", metavar=("PLANNED_PATH", "LOCAL_PATH"),
                         help="Read exact retained bytes from another location without changing the plan or original path")
    compact = sub.add_parser("compact-metadata", help="Losslessly compact one completed operation's exact JSON metadata")
    compact.add_argument("--plan", required=True)
    compact.add_argument("--metadata-file", action="append", help="Exact additional completed report or manifest beside this plan")
    compact.add_argument("--work-dir", help="The original operation's same-filesystem work directory")
    compact.add_argument("--runtime-consumers-root", help="same original registry used by the retained plan")
    expand = sub.add_parser("expand-metadata", help="Recover exact original JSON into a separate create-only file")
    expand.add_argument("--metadata-file", required=True)
    expand.add_argument("--destination", required=True)
    for report in (remove, closed, join, inspect, compact):
        report.add_argument("--summary", action="store_true", help="Return counts and at most 20 actual issues; full API result is unchanged")
    args = parser.parse_args(argv)
    try:
        if args.command == "git-manifest":
            result = create_git_manifest(read_json(args.inventory), args.output)
        elif args.command == "plan":
            result = create_plan(read_json(args.manifest), args.output,
                                 runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "retire":
            result = retire(args.plan, work_dir=args.work_dir, runtime_consumers_root=args.runtime_consumers_root,
                            file_use=args.require_unused)
        elif args.command == "prepare-release":
            from cache_closed_release import prepare
            result = prepare(args.plan, expected_plan=args.expected_plan,
                             runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "release":
            from cache_closed_release import release
            result = release(args.plan, expected_plan=args.expected_plan,
                             runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "coalesce":
            result = coalesce(args.plan, work_dir=args.work_dir, inode_contract=args.inode_contract)
        elif args.command == "status":
            result = status(args.plan, verify_custody=args.verify_custody,
                            runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "compact-metadata":
            from cache_metadata import compact as compact_metadata
            result = compact_metadata(args.plan, cache=sys.modules[__name__],
                                      files=args.metadata_file, work_dir=args.work_dir,
                                      runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "expand-metadata":
            from cache_metadata import expand as expand_metadata
            result = expand_metadata(args.metadata_file, args.destination, cache=sys.modules[__name__])
        else:
            result = restore(args.plan, args.destination, entries=args.entry, custody_files=args.custody_file)
        if getattr(args, "summary", False):
            from cache_metadata import summarize
            result = summarize(result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok", True) else 2
    except (OSError, ValueError, KeyError, TypeError, CacheError, zipfile.BadZipFile) as exc:
        print(json.dumps({"ok": False, "error": str(exc),
                          **({"file_use": exc.file_use} if getattr(exc, "file_use", None) else {})},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

