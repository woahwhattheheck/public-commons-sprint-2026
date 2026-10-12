#!/usr/bin/env python3
# MIT. Streaming archive and receiving for the original gRPC workspace.
# Input and output are one JSON document. This helper never starts a service.
import bisect
import contextlib
import ctypes
import datetime
import errno
import fcntl
import gzip
import hashlib
import io
import json
import math
import os
import re
import stat
import sys
import tarfile
import uuid
import zlib

MANIFEST = "grpc-workspace-transfer.json"
ARCHIVE = "grpc-workspace.tar.gz"
TRANSFER_SCHEMA = "stellar-forge.grpc-workspace-transfer.v1"
ARCHIVE_SCHEMA = "stellar-forge.grpc-workspace-archive.v1"
RECEIVING_SCHEMA = "stellar-forge.grpc-workspace-receiving.v1"
BINDING_SCHEMA = "stellar-forge.grpc-workspace-binding.v1"
MANIFEST_LIMIT = 16 * 1024 * 1024
FILE_LIMIT = 1024 * 1024 * 1024
TOTAL_LIMIT = 64 * 1024 * 1024 * 1024
ARCHIVE_LIMIT = TOTAL_LIMIT + 256 * 1024 * 1024
FILES_LIMIT = 50000
CHUNK = 1024 * 1024
SAFE_INTEGER = 9007199254740991
PAX_LIMIT = 8192
SOURCE_META = ".grpc-transfer-source.json"
RECEIPT_META = ".grpc-transfer-receiving.json"
OBSERVATIONS = ".grpc-transfer-observations"
COUNTS = ("revisions", "reflections", "attempts", "health", "upgrades",
          "incidents", "preparations", "releases")
UUID = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
ENV = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


class TransferError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def fail(code):
    raise TransferError("GRPC_TRANSFER_" + code)


def fields(value, names, required=None):
    if not isinstance(value, dict) or set(value) - set(names):
        fail("FIELDS_INVALID")
    if required is not None and set(required) - set(value):
        fail("FIELDS_INVALID")


def integer(value, maximum, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("INTEGER_INVALID")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        fail("INTEGER_INVALID")
    if value < minimum or value > min(maximum, SAFE_INTEGER):
        fail("INTEGER_INVALID")
    return int(value)


def digest_string(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        fail("SHA256_INVALID")
    return value


def identity_string(value):
    if not isinstance(value, str) or not UUID.fullmatch(value):
        fail("ID_INVALID")
    return value


def utf16(value):
    return value.encode("utf-16-be", "surrogatepass")


def utf8(value):
    try:
        return value.encode("utf-8", "strict")
    except UnicodeError:
        fail("TEXT_INVALID")


def canonical(value):
    # All numeric fields in the closed manifest are safe integers. JSON.stringify
    # represents integral JSON numbers without a decimal point.
    if value is None or isinstance(value, (str, bool)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if isinstance(value, (int, float)):
        return str(integer(value, SAFE_INTEGER))
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key])
                              for key in sorted(value, key=utf16)) + "}"
    fail("JSON_INVALID")


def json_bytes(value):
    return utf8(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)) + b"\n"


def parse_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                fail("JSON_DUPLICATE_KEY")
            result[key] = value
        return result

    def constant(_value):
        fail("JSON_INVALID")

    try:
        return json.loads(data.decode("utf-8", "strict"),
                          object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        fail("JSON_INVALID")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def absolute(value):
    if (not isinstance(value, str) or not value or "\0" in value or
            not os.path.isabs(value) or os.path.normpath(value) != value or value.startswith("//")):
        fail("ABSOLUTE_PATH_REQUIRED")
    utf8(value)
    return value


def portable(value, prefixes=True):
    if (not isinstance(value, str) or not value or len(utf16(value)) > 1024 or
            value.startswith("/") or re.search(r"[\\\x00-\x1f\x7f]", value) or
            any(part in ("", ".", "..") for part in value.split("/"))):
        fail("PATH_INVALID")
    utf8(value)
    if prefixes and not value.startswith(("workspace/", "observations/")):
        fail("PATH_INVALID")
    return value


def private(stat_value, directory=False):
    if (stat_value.st_uid != os.getuid() or stat_value.st_mode & 0o077 or
            not (stat.S_ISDIR(stat_value.st_mode) if directory else stat.S_ISREG(stat_value.st_mode))):
        fail("PRIVATE_DIRECTORY_REQUIRED" if directory else "PRIVATE_FILE_REQUIRED")


def same_inode(left, right):
    return left.st_dev == right.st_dev and left.st_ino == right.st_ino


def same_file(left, right):
    return (same_inode(left, right) and left.st_size == right.st_size and
            left.st_mtime_ns == right.st_mtime_ns and left.st_ctime_ns == right.st_ctime_ns)


def check_fd_name(fd, parent, name, before=None):
    after = os.fstat(fd)
    named = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not same_inode(after, named) or stat.S_ISLNK(named.st_mode):
        fail("FILE_CHANGED")
    if before is not None and not same_file(before, after):
        fail("FILE_CHANGED")
    return after


def fsync_dir(fd):
    os.fsync(fd)


class Directory:
    def __init__(self, path):
        self.path = absolute(path)
        before = os.lstat(path)
        private(before, True)
        if stat.S_ISLNK(before.st_mode) or os.path.realpath(path) != path:
            fail("PRIVATE_DIRECTORY_REQUIRED")
        self.fd = os.open(path, DIR_FLAGS)
        if not same_inode(before, os.fstat(self.fd)):
            os.close(self.fd)
            fail("DIRECTORY_CHANGED")
        self.identity = before

    def check(self):
        current = os.lstat(self.path)
        if (not same_inode(self.identity, current) or
                not same_inode(current, os.fstat(self.fd)) or
                os.path.realpath(self.path) != self.path):
            fail("DIRECTORY_CHANGED")
        private(current, True)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def child_directory(parent, name, create=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
            fsync_dir(parent)
        except FileExistsError:
            pass
    fd = os.open(name, DIR_FLAGS, dir_fd=parent)
    try:
        private(os.fstat(fd), True)
        check_fd_name(fd, parent, name)
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextlib.contextmanager
def path_parent(root, relative, create=False):
    portable(relative, False)
    parts = relative.split("/")
    fd = os.dup(root)
    try:
        for name in parts[:-1]:
            next_fd = child_directory(fd, name, create)
            os.close(fd)
            fd = next_fd
        yield fd, parts[-1]
    finally:
        os.close(fd)


def open_regular(parent, name, cap, flags=READ_FLAGS, mode=0o600, single_link=False):
    fd = os.open(name, flags, mode, dir_fd=parent)
    try:
        info = os.fstat(fd)
        private(info)
        if info.st_size < 0 or info.st_size > cap or single_link and info.st_nlink != 1:
            fail("FILE_SIZE_OR_LINK_INVALID")
        check_fd_name(fd, parent, name)
        return fd, info
    except BaseException:
        os.close(fd)
        raise


def read_fd(fd, size):
    result = bytearray()
    while len(result) < size:
        block = os.read(fd, min(CHUNK, size - len(result)))
        if not block:
            fail("FILE_CHANGED")
        result.extend(block)
    return bytes(result)


def read_relative(root, path, cap):
    with path_parent(root, path) as (parent, name):
        fd, info = open_regular(parent, name, cap)
        try:
            data = read_fd(fd, info.st_size)
            check_fd_name(fd, parent, name, info)
            return data
        finally:
            os.close(fd)


def read_optional(root, path, cap):
    try:
        return read_relative(root, path, cap)
    except FileNotFoundError:
        return None


def write_all(fd, data, offset=None):
    total = 0
    while total < len(data):
        count = (os.write(fd, data[total:]) if offset is None
                 else os.pwrite(fd, data[total:], offset + total))
        if count <= 0:
            fail("WRITE_FAILED")
        total += count


def rename_no_replace(source_parent, source, target_parent, target):
    library = ctypes.CDLL(None, use_errno=True)
    native = getattr(library, "renameat2", None)
    if native is None:
        fail("NOREPLACE_UNAVAILABLE")
    native.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    native.restype = ctypes.c_int
    if native(source_parent, os.fsencode(source), target_parent, os.fsencode(target), 1):
        issue = ctypes.get_errno()
        if issue == errno.EEXIST:
            raise FileExistsError(issue, "destination exists")
        if issue in (errno.ENOSYS, errno.EINVAL, errno.ENOTSUP):
            fail("NOREPLACE_UNAVAILABLE")
        raise OSError(issue, "no-replace publication failed")


def immutable_bytes(parent, name, data):
    existing = read_optional(parent, name, max(len(data), 65536))
    if existing is not None:
        if existing != data:
            fail("RECEIVING_ID_CONFLICT")
        return
    temporary = "." + name + "." + str(uuid.uuid4()) + ".tmp"
    fd = None
    try:
        fd, _ = open_regular(parent, temporary, len(data),
                             os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC)
        write_all(fd, data)
        os.fsync(fd)
        os.close(fd)
        fd = None
        try:
            rename_no_replace(parent, temporary, parent, name)
        except FileExistsError:
            if read_relative(parent, name, max(len(data), 65536)) != data:
                fail("RECEIVING_ID_CONFLICT")
        fsync_dir(parent)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=parent)
            fsync_dir(parent)
        except FileNotFoundError:
            pass


class Guard:
    def __init__(self, parent, name):
        self.parent = parent
        self.name = name
        self.fd, self.before = open_regular(
            parent, name, 0, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
            single_link=True)
        try:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail("RECEIVING_BUSY")
            check_fd_name(self.fd, parent, name)
            fsync_dir(parent)
        except BaseException:
            os.close(self.fd)
            self.fd = None
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        # This inode is permanent; closing the FD releases it even after a crash.
        os.close(self.fd)
        self.fd = None


def validate_binding(value):
    fields(value, ("schema", "directory", "identity", "current"),
           ("schema", "directory", "identity", "current"))
    if value["schema"] != BINDING_SCHEMA:
        fail("ORIGIN_INVALID")
    absolute(value["directory"])
    identity = value["identity"]
    fields(identity, ("device", "inode"), ("device", "inode"))
    if (not isinstance(identity["device"], str) or
            not re.fullmatch(r"0|[1-9][0-9]*", identity["device"]) or
            not isinstance(identity["inode"], str) or
            not re.fullmatch(r"[1-9][0-9]*", identity["inode"])):
        fail("ORIGIN_INVALID")
    current = value["current"]
    if current is not None:
        fields(current, ("revision", "generation", "sha256"), ("revision", "generation", "sha256"))
        digest_string(current["revision"])
        digest_string(current["sha256"])
        integer(current["generation"], SAFE_INTEGER, 1)


def validate_manifest(value):
    keys = ("schema", "id", "createdAt", "origin", "counts", "environmentNames",
            "health", "files", "bytes", "sha256")
    fields(value, keys, keys)
    if value["schema"] != TRANSFER_SCHEMA:
        fail("MANIFEST_INVALID")
    identity_string(value["id"])
    digest_string(value["sha256"])
    created = value["createdAt"]
    if not isinstance(created, str) or len(created) > 40 or not re.match(r"^\d{4}-\d{2}-\d{2}T", created):
        fail("MANIFEST_INVALID")
    try:
        datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
    except ValueError:
        fail("MANIFEST_INVALID")
    fields(value["origin"], ("directory", "binding"), ("directory", "binding"))
    validate_binding(value["origin"]["binding"])
    if value["origin"]["directory"] != value["origin"]["binding"]["directory"]:
        fail("ORIGIN_INVALID")
    fields(value["counts"], COUNTS, COUNTS)
    for key in COUNTS:
        integer(value["counts"][key], FILES_LIMIT)
    names = value["environmentNames"]
    if not isinstance(names, list) or len(names) > 4096:
        fail("MANIFEST_INVALID")
    previous = None
    for name in names:
        if not isinstance(name, str) or not ENV.fullmatch(name) or previous is not None and previous >= name:
            fail("MANIFEST_INVALID")
        previous = name
    files = value["files"]
    if not isinstance(files, list) or len(files) > FILES_LIMIT:
        fail("MANIFEST_INVALID")
    by_path, total, previous = {}, 0, None
    for entry in files:
        fields(entry, ("path", "bytes", "sha256", "kind"), ("path", "bytes", "sha256", "kind"))
        path = portable(entry["path"])
        digest_string(entry["sha256"])
        size = integer(entry["bytes"], FILE_LIMIT)
        if previous is not None and utf16(previous) >= utf16(path):
            fail("MANIFEST_INVALID")
        previous = path
        if path in by_path:
            fail("MANIFEST_INVALID")
        by_path[path] = entry
        total += size
        if total > TOTAL_LIMIT:
            fail("TOO_LARGE")
        if entry["kind"] not in ("workspace", "health-prefix", "observation"):
            fail("MANIFEST_INVALID")
        if (entry["kind"] == "observation") != path.startswith("observations/"):
            fail("MANIFEST_INVALID")
        if (entry["kind"] == "health-prefix" and
                not re.fullmatch(r"workspace/health/[a-f0-9-]{36}/events\.ndjson", path)):
            fail("MANIFEST_INVALID")
        historical_roots = ("workspace/transfers", "workspace/temporary",
                            "workspace/managed-launches", "workspace/merchant-releases.receiving")
        if (path in ("workspace/lease.lock", "workspace/run.json",
                     "workspace/merchant-releases/runtime.json") or
                any(path == root or path.startswith(root + "/") for root in historical_roots) or
                re.search(r"/(?:run|state)\.lock(?:/|$)", path) or
                re.search(r"/.sf82-(?:run|state)\.lock\.lifetime$", path) or
                re.match(r"^workspace/merchant-releases/releases/[^/]+/"
                         r"(?:pilot-runtime\.json|runtime-readiness\.json|grpc-runtime)(?:/|$)", path) or
                path in ("workspace/" + SOURCE_META, "workspace/" + RECEIPT_META,
                         "workspace/" + OBSERVATIONS) or
                path.startswith("workspace/" + OBSERVATIONS + "/")):
            fail("MANIFEST_OWNERSHIP_PATH")
    for path in by_path:
        parts = path.split("/")
        for position in range(1, len(parts)):
            if "/".join(parts[:position]) in by_path:
                fail("MANIFEST_FILE_ANCESTOR")
    if integer(value["bytes"], TOTAL_LIMIT) != total:
        fail("MANIFEST_INVALID")
    health = value["health"]
    if not isinstance(health, list) or len(health) > FILES_LIMIT:
        fail("MANIFEST_INVALID")
    previous = ""
    for item in health:
        fields(item, ("id", "throughSequence", "snapshotSha256", "bytes"),
               ("id", "throughSequence", "snapshotSha256", "bytes"))
        identity_string(item["id"])
        digest_string(item["snapshotSha256"])
        integer(item["throughSequence"], 10130)
        size = integer(item["bytes"], FILE_LIMIT)
        if item["id"] <= previous:
            fail("MANIFEST_INVALID")
        previous = item["id"]
        prefix = "workspace/health/" + item["id"] + "/"
        journal = by_path.get(prefix + "events.ndjson")
        if (prefix + "operation.json" not in by_path or journal is None or
                journal["kind"] != "health-prefix" or journal["bytes"] != size):
            fail("MANIFEST_INVALID")
    if len(health) != value["counts"]["health"]:
        fail("MANIFEST_INVALID")
    body = {key: item for key, item in value.items() if key != "sha256"}
    if sha256(utf8(canonical(body))) != value["sha256"]:
        fail("MANIFEST_CHANGED")
    if len(json_bytes(value)) - 1 > MANIFEST_LIMIT:
        fail("MANIFEST_TOO_LARGE")
    return value


class Membership:
    def __init__(self, paths, empty_roots=()):
        self.empty_roots = set(empty_roots)
        self.root_seen = set()
        self.paths = sorted(paths)
        self.indices = {path: number for number, path in enumerate(self.paths)}
        self.file_seen = bytearray((len(self.paths) + 7) // 8)
        # A directory is uniquely the first descendant file and its prefix depth.
        # A bitset avoids retaining millions of expanded long prefix strings.
        self.directory_seen = bytearray((len(self.paths) * 257 + 7) // 8)
        self.seen_files = 0

    def directory_key(self, path):
        prefix = path + "/"
        index = bisect.bisect_left(self.paths, prefix)
        if index >= len(self.paths) or not self.paths[index].startswith(prefix):
            fail("UNEXPECTED_DIRECTORY")
        return index * 257 + path.count("/")

    def allowed_directory(self, path):
        if path not in self.empty_roots:
            self.directory_key(path)

    def mark_directory(self, path):
        if path in self.empty_roots:
            if path in self.root_seen:
                fail("DUPLICATE_MEMBER")
            self.root_seen.add(path)
            return
        key = self.directory_key(path)
        byte, bit = divmod(key, 8)
        if self.directory_seen[byte] & (1 << bit):
            fail("DUPLICATE_MEMBER")
        self.directory_seen[byte] |= 1 << bit

    def mark_file(self, path):
        if path not in self.indices:
            fail("UNEXPECTED_MEMBER")
        key = self.indices[path]
        byte, bit = divmod(key, 8)
        if self.file_seen[byte] & (1 << bit):
            fail("DUPLICATE_MEMBER")
        self.file_seen[byte] |= 1 << bit
        self.seen_files += 1


class HashingReader:
    def __init__(self, raw, maximum):
        self.raw = raw
        self.maximum = maximum
        self.count = 0
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        if size < 0:
            size = CHUNK
        block = self.raw.read(min(size, CHUNK))
        self.count += len(block)
        if self.count > self.maximum:
            fail("ARCHIVE_TOO_LARGE")
        self.hash.update(block)
        return block


def read_exact(stream, size):
    result = bytearray()
    while len(result) < size:
        block = stream.read(min(CHUNK, size - len(result)))
        if not block:
            fail("ARCHIVE_TRUNCATED")
        result.extend(block)
    return bytes(result)


def zero_padding(stream, size):
    if size and any(read_exact(stream, size)):
        fail("ARCHIVE_PADDING_INVALID")


class Body:
    def __init__(self, stream, size):
        self.stream = stream
        self.remaining = size

    def read(self, size=CHUNK):
        count = min(self.remaining, size, CHUNK)
        if not count:
            return b""
        block = read_exact(self.stream, count)
        self.remaining -= len(block)
        return block

    def drain(self):
        while self.remaining:
            self.read()


def pax_path(data):
    position, result = 0, {}
    while position < len(data):
        space = data.find(b" ", position, position + 24)
        if space < 0 or not re.fullmatch(rb"[1-9][0-9]*", data[position:space]):
            fail("ARCHIVE_PAX_INVALID")
        size = int(data[position:space])
        end = position + size
        if size < 5 or end > len(data) or data[end - 1:end] != b"\n":
            fail("ARCHIVE_PAX_INVALID")
        field = data[space + 1:end - 1]
        if b"=" not in field:
            fail("ARCHIVE_PAX_INVALID")
        key, value = field.split(b"=", 1)
        # The maintained writer emits only a local path extension. Never accept
        # sparse/global/size/link overrides with different extraction semantics.
        if key != b"path" or key in result:
            fail("ARCHIVE_PAX_UNSUPPORTED")
        result[key] = value.decode("utf-8", "strict")
        position = end
    if b"path" not in result:
        fail("ARCHIVE_PAX_INVALID")
    return result[b"path"]


def members(stream):
    pending = None
    headers, regulars, payload = 0, 0, 0
    while True:
        header = read_exact(stream, 512)
        if header == b"\0" * 512:
            if pending is not None:
                fail("ARCHIVE_PAX_INVALID")
            if read_exact(stream, 512) != b"\0" * 512:
                fail("ARCHIVE_END_INVALID")
            tail = 0
            while True:
                block = stream.read(CHUNK)
                if not block:
                    return
                tail += len(block)
                if tail > 10240 or any(block):
                    fail("ARCHIVE_TRAILING_DATA")
        headers += 1
        if headers > (FILES_LIMIT * 258 + 1) * 2:
            fail("ARCHIVE_MEMBERS_EXCEEDED")
        try:
            info = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
        except (tarfile.HeaderError, ValueError, UnicodeError, OverflowError):
            fail("ARCHIVE_HEADER_INVALID")
        raw_type = header[156:157]
        if raw_type == b"x":
            if pending is not None or info.size < 1 or info.size > PAX_LIMIT or info.linkname:
                fail("ARCHIVE_PAX_INVALID")
            data = read_exact(stream, info.size)
            zero_padding(stream, (-info.size) % 512)
            pending = pax_path(data)
            continue
        if raw_type not in (b"0", b"\0", b"5") or info.linkname or getattr(info, "sparse", None):
            fail("ARCHIVE_MEMBER_TYPE_INVALID")
        path = pending if pending is not None else info.name
        pending = None
        is_directory = raw_type == b"5"
        if is_directory and path.endswith("/"):
            path = path[:-1]
        portable(path, False)
        if path != MANIFEST and path not in ("workspace", "observations"):
            portable(path)
        if path in ("workspace", "observations") and not is_directory:
            fail("ARCHIVE_MEMBER_TYPE_INVALID")
        if is_directory and info.size != 0:
            fail("ARCHIVE_DIRECTORY_DATA")
        cap = MANIFEST_LIMIT if path == MANIFEST else FILE_LIMIT
        size = integer(info.size, cap)
        if not is_directory:
            regulars += 1
            payload += size
            if regulars > FILES_LIMIT + 1 or payload > TOTAL_LIMIT + MANIFEST_LIMIT:
                fail("ARCHIVE_TOO_LARGE")
        body = Body(stream, size)
        yield path, is_directory, size, body
        if body.remaining:
            fail("ARCHIVE_READER_INCOMPLETE")
        zero_padding(stream, (-size) % 512)


class ArchiveSource:
    def __init__(self, path):
        self.path = absolute(path)
        self.parent = Directory(os.path.dirname(path))
        self.name = os.path.basename(path)
        self.fd = None
        try:
            self.fd, self.before = open_regular(self.parent.fd, self.name, ARCHIVE_LIMIT)
            if self.before.st_size < 1:
                fail("ARCHIVE_EMPTY")
        except BaseException:
            if self.fd is not None:
                os.close(self.fd)
            self.parent.close()
            raise
        self.manifest_bytes = None
        self.manifest = None
        self.descriptor = None

    @contextlib.contextmanager
    def stream(self):
        os.lseek(self.fd, 0, os.SEEK_SET)
        raw = os.fdopen(os.dup(self.fd), "rb", buffering=0)
        hashed = HashingReader(raw, ARCHIVE_LIMIT)
        compressed = gzip.GzipFile(fileobj=hashed, mode="rb")
        try:
            yield compressed, hashed
        finally:
            compressed.close()
            raw.close()

    def check(self):
        check_fd_name(self.fd, self.parent.fd, self.name, self.before)
        self.parent.check()

    def find_manifest(self):
        with self.stream() as (stream, _hashed):
            for path, is_directory, size, body in members(stream):
                if path == MANIFEST:
                    if is_directory:
                        fail("MANIFEST_INVALID")
                    data = bytearray()
                    while body.remaining:
                        data.extend(body.read())
                    self.manifest_bytes = bytes(data)
                    self.manifest = validate_manifest(parse_json(self.manifest_bytes))
                    self.check()
                    return
                body.drain()
        fail("MANIFEST_MISSING")

    def scan(self, visitor=None):
        if self.manifest is None:
            self.find_manifest()
        files = {entry["path"]: entry for entry in self.manifest["files"]}
        membership = Membership(files, ("workspace", "observations"))
        root_seen = False
        with self.stream() as (stream, hashed):
            for path, is_directory, size, body in members(stream):
                if path == MANIFEST:
                    if root_seen or is_directory:
                        fail("DUPLICATE_MANIFEST")
                    root_seen = True
                    data = bytearray()
                    while body.remaining:
                        data.extend(body.read())
                    if bytes(data) != self.manifest_bytes:
                        fail("MANIFEST_CHANGED")
                elif is_directory:
                    membership.mark_directory(path)
                else:
                    membership.mark_file(path)
                    entry = files[path]
                    if size != entry["bytes"]:
                        fail("MEMBER_SIZE_CHANGED")
                    hash_value = hashlib.sha256()
                    sink = visitor(path, entry) if visitor is not None else None
                    try:
                        offset = 0
                        while body.remaining:
                            block = body.read()
                            hash_value.update(block)
                            if sink is not None:
                                sink.write(block, offset)
                            offset += len(block)
                        if hash_value.hexdigest() != entry["sha256"]:
                            fail("MEMBER_CHANGED")
                        if sink is not None:
                            sink.finish()
                    finally:
                        if sink is not None:
                            sink.close()
            if not root_seen or membership.seen_files != len(files):
                fail("MEMBERS_MISSING")
            if hashed.count != self.before.st_size:
                fail("ARCHIVE_CHANGED")
            observed = {"schema": ARCHIVE_SCHEMA, "sha256": hashed.hash.hexdigest(),
                        "bytes": hashed.count, "filename": ARCHIVE,
                        "manifestSha256": self.manifest["sha256"], "manifest": self.manifest}
        self.check()
        if self.descriptor is not None and (observed["sha256"] != self.descriptor["sha256"] or
                                            observed["bytes"] != self.descriptor["bytes"]):
            fail("ARCHIVE_CHANGED")
        self.descriptor = observed
        return observed

    def inspect(self, request):
        if "expectedBytes" in request:
            if self.before.st_size != integer(request["expectedBytes"], ARCHIVE_LIMIT, 1):
                fail("ARCHIVE_CHANGED")
        self.find_manifest()
        if "expectedManifestSha256" in request:
            if self.manifest["sha256"] != digest_string(request["expectedManifestSha256"]):
                fail("MANIFEST_CHANGED")
        result = self.scan()
        if "expectedSha256" in request and result["sha256"] != digest_string(request["expectedSha256"]):
            fail("ARCHIVE_CHANGED")
        return result

    def close(self):
        os.close(self.fd)
        self.parent.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def tree_check(root, expected, partial=False, check_hashes=False, empty_roots=()):
    membership = Membership(expected, empty_roots)

    def visit(directory, prefix=""):
        with os.scandir(directory) as entries:
            for item in entries:
                relative = prefix + item.name
                info = item.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    private(info, True)
                    membership.allowed_directory(relative)
                    child = child_directory(directory, item.name)
                    try:
                        visit(child, relative + "/")
                        if check_hashes:
                            fsync_dir(child)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    private(info)
                    if relative not in expected:
                        fail("UNEXPECTED_FILE")
                    entry = expected[relative]
                    size = entry["bytes"]
                    if info.st_size > size or not partial and info.st_size != size:
                        fail("FILE_SIZE_CHANGED")
                    membership.mark_file(relative)
                    fd, before = open_regular(directory, item.name, size,
                                               single_link=partial or check_hashes)
                    try:
                        if check_hashes:
                            digest = hashlib.sha256()
                            count = 0
                            while count < before.st_size:
                                block = os.read(fd, min(CHUNK, before.st_size - count))
                                if not block:
                                    fail("FILE_CHANGED")
                                digest.update(block)
                                count += len(block)
                            if count != size or digest.hexdigest() != entry["sha256"]:
                                fail("FILE_CHANGED")
                        check_fd_name(fd, directory, item.name, before)
                    finally:
                        os.close(fd)
                else:
                    fail("FILE_TYPE_INVALID")
    visit(root)
    if not partial and membership.seen_files != len(expected):
        fail("FILES_MISSING")


class PackedReader:
    def __init__(self, fd, size):
        self.fd = fd
        self.size = size
        self.bytes = 0
        self.hash = hashlib.sha256()

    def read(self, size):
        count = min(size, self.size - self.bytes)
        result = read_fd(self.fd, count)
        self.bytes += len(result)
        self.hash.update(result)
        return result


class LimitedWriter:
    def __init__(self, raw):
        self.raw = raw
        self.bytes = 0

    def write(self, value):
        if self.bytes + len(value) > ARCHIVE_LIMIT:
            fail("ARCHIVE_TOO_LARGE")
        count = 0
        while count < len(value):
            written = self.raw.write(value[count:])
            if not written:
                fail("WRITE_FAILED")
            count += written
            self.bytes += written
        return count

    def flush(self):
        self.raw.flush()


def hash_file(parent, name, cap):
    fd, info = open_regular(parent, name, cap)
    try:
        digest, count = hashlib.sha256(), 0
        while count < info.st_size:
            block = os.read(fd, min(CHUNK, info.st_size - count))
            if not block:
                fail("FILE_CHANGED")
            digest.update(block)
            count += len(block)
        check_fd_name(fd, parent, name, info)
        return {"sha256": digest.hexdigest(), "bytes": count}
    finally:
        os.close(fd)


def tar_info(path, size):
    value = tarfile.TarInfo(path)
    value.size = size
    value.mode = 0o600
    value.uid = value.gid = value.mtime = 0
    value.uname = value.gname = ""
    value.type = tarfile.REGTYPE
    return value


def pack(request):
    fields(request, ("command", "snapshotDirectory", "archivePath", "expectedManifestSha256"),
           ("command", "snapshotDirectory", "archivePath", "expectedManifestSha256"))
    snapshot_path, archive_path = absolute(request["snapshotDirectory"]), absolute(request["archivePath"])
    if archive_path == snapshot_path or archive_path.startswith(snapshot_path + "/"):
        fail("ARCHIVE_INSIDE_SNAPSHOT")
    expected_sha = digest_string(request["expectedManifestSha256"])
    with Directory(snapshot_path) as snapshot, Directory(os.path.dirname(archive_path)) as parent:
        name = os.path.basename(archive_path)
        key = sha256(utf8(archive_path))
        prefix = ".grpc-transfer-pack-" + key
        with Guard(parent.fd, prefix + ".lock"):
            data = read_relative(snapshot.fd, MANIFEST, MANIFEST_LIMIT)
            manifest = validate_manifest(parse_json(data))
            if manifest["sha256"] != expected_sha:
                fail("MANIFEST_CHANGED")
            try:
                os.stat(name, dir_fd=parent.fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                with ArchiveSource(archive_path) as existing:
                    result = existing.inspect({"expectedManifestSha256": expected_sha})
                    if existing.manifest_bytes != data:
                        fail("MANIFEST_CHANGED")
                    return result
            intent = {"schema": "stellar-forge.grpc-workspace-pack-intent.v1",
                      "archivePath": archive_path, "snapshotDirectory": snapshot_path,
                      "manifestSha256": expected_sha, "manifestBytesSha256": sha256(data)}
            immutable_bytes(parent.fd, prefix + ".json", json_bytes(intent))
            expected = {entry["path"]: entry for entry in manifest["files"]}
            expected[MANIFEST] = {"bytes": len(data), "sha256": sha256(data)}
            tree_check(snapshot.fd, expected, empty_roots=("workspace", "observations"))
            temporary = prefix + ".partial"
            output, _ = open_regular(parent.fd, temporary, ARCHIVE_LIMIT,
                                     os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     single_link=True)
            try:
                os.ftruncate(output, 0)
                raw = os.fdopen(os.dup(output), "wb", buffering=0)
                try:
                    writer = LimitedWriter(raw)
                    with gzip.GzipFile(filename="", fileobj=writer, mode="wb", mtime=0, compresslevel=6) as compressed:
                        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT,
                                          encoding="utf-8", errors="strict") as archive:
                            archive.addfile(tar_info(MANIFEST, len(data)), io.BytesIO(data))
                            for entry in manifest["files"]:
                                with path_parent(snapshot.fd, entry["path"]) as (source_parent, source_name):
                                    source, before = open_regular(source_parent, source_name, FILE_LIMIT)
                                    try:
                                        if before.st_size != entry["bytes"]:
                                            fail("FILE_SIZE_CHANGED")
                                        reader = PackedReader(source, before.st_size)
                                        archive.addfile(tar_info(entry["path"], before.st_size), reader)
                                        if reader.bytes != before.st_size or reader.hash.hexdigest() != entry["sha256"]:
                                            fail("FILE_CHANGED")
                                        check_fd_name(source, source_parent, source_name, before)
                                    finally:
                                        os.close(source)
                    writer.flush()
                finally:
                    raw.close()
                os.fsync(output)
                check_fd_name(output, parent.fd, temporary)
            finally:
                os.close(output)
            tree_check(snapshot.fd, expected, empty_roots=("workspace", "observations"))
            if read_relative(snapshot.fd, MANIFEST, MANIFEST_LIMIT) != data:
                fail("MANIFEST_CHANGED")
            snapshot.check()
            parent.check()
            observed = hash_file(parent.fd, temporary, ARCHIVE_LIMIT)
            try:
                rename_no_replace(parent.fd, temporary, parent.fd, name)
            except FileExistsError:
                with ArchiveSource(archive_path) as existing:
                    result = existing.inspect({"expectedManifestSha256": expected_sha})
                    if existing.manifest_bytes != data or result["sha256"] != observed["sha256"]:
                        fail("ARCHIVE_CONFLICT")
                    return result
            fsync_dir(parent.fd)
            parent.check()
            return {"schema": ARCHIVE_SCHEMA, **observed, "filename": ARCHIVE,
                    "manifestSha256": expected_sha, "manifest": manifest}


def restored_path(path):
    if path.startswith("workspace/"):
        return path[len("workspace/"):]
    return OBSERVATIONS + "/" + path[len("observations/"):]


class ReceivingSink:
    def __init__(self, root, path, entry):
        self.parent_context = path_parent(root, restored_path(path), True)
        self.parent, self.name = self.parent_context.__enter__()
        self.fd = None
        try:
            self.fd, self.before = open_regular(
                self.parent, self.name, entry["bytes"],
                os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                single_link=True)
            self.original_size = self.before.st_size
            self.expected_size = entry["bytes"]
        except BaseException:
            self.parent_context.__exit__(None, None, None)
            raise

    def write(self, block, offset):
        matched = min(len(block), max(0, self.original_size - offset))
        if matched:
            existing, count = bytearray(), 0
            while count < matched:
                part = os.pread(self.fd, matched - count, offset + count)
                if not part:
                    fail("PARTIAL_FILE_CHANGED")
                existing.extend(part)
                count += len(part)
            if bytes(existing) != block[:matched]:
                fail("PARTIAL_FILE_CHANGED")
        if matched < len(block):
            write_all(self.fd, block[matched:], offset + matched)

    def finish(self):
        os.fsync(self.fd)
        info = check_fd_name(self.fd, self.parent, self.name)
        if info.st_size != self.expected_size:
            fail("FILE_SIZE_CHANGED")
        private(info)
        if info.st_nlink != 1:
            fail("FILE_SIZE_OR_LINK_INVALID")
        fsync_dir(self.parent)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        self.parent_context.__exit__(None, None, None)


def receiving_binding(request, archive, target):
    return {"operationId": identity_string(request["operationId"]),
            "archiveSha256": archive["sha256"], "archiveBytes": archive["bytes"],
            "manifestSha256": archive["manifestSha256"], "transferId": archive["manifest"]["id"],
            "directory": target}


def validate_receipt(data, binding):
    value = parse_json(data)
    fields(value, ("schema", "operationId", "archiveSha256", "archiveBytes",
                   "manifestSha256", "transferId", "directory", "receivedAt"),
           ("schema", "operationId", "archiveSha256", "archiveBytes",
            "manifestSha256", "transferId", "directory", "receivedAt"))
    if value["schema"] != RECEIVING_SCHEMA or any(value.get(key) != item for key, item in binding.items()):
        fail("RECEIVING_ID_CONFLICT")
    if not isinstance(value["receivedAt"], str):
        fail("RECEIVING_RECEIPT_INVALID")
    try:
        datetime.datetime.fromisoformat(value["receivedAt"].replace("Z", "+00:00"))
    except ValueError:
        fail("RECEIVING_RECEIPT_INVALID")
    return value


def accepted_target(parent, name, archive, binding):
    try:
        target = child_directory(parent, name)
    except FileNotFoundError:
        return None
    try:
        receipt_bytes = read_optional(target, RECEIPT_META, 65536)
        if receipt_bytes is None:
            fail("DESTINATION_EXISTS")
        receipt = validate_receipt(receipt_bytes, binding)
        if read_relative(target, SOURCE_META, MANIFEST_LIMIT) != archive.manifest_bytes:
            fail("RECEIVING_SOURCE_CHANGED")
        # Native state may have advanced after the original acceptance. Do not
        # recopy or compare it to the old snapshot on an identical receive.
        return receipt
    finally:
        os.close(target)


def publish_payload_metadata(stage, payload, name, data):
    existing = read_optional(payload, name, max(len(data), 65536))
    if existing is not None:
        if existing != data:
            fail("RECEIVING_ID_CONFLICT")
        return
    temporary = "manifest.publish" if name == SOURCE_META else "receipt.publish"
    fd, _ = open_regular(stage, temporary, max(len(data), 65536),
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                         single_link=True)
    try:
        os.ftruncate(fd, 0)
        write_all(fd, data)
        os.fsync(fd)
        check_fd_name(fd, stage, temporary)
    finally:
        os.close(fd)
    try:
        rename_no_replace(stage, temporary, payload, name)
    except FileExistsError:
        if read_relative(payload, name, max(len(data), 65536)) != data:
            fail("RECEIVING_ID_CONFLICT")
        os.unlink(temporary, dir_fd=stage)
    fsync_dir(payload)
    fsync_dir(stage)


def receive(request):
    keys = ("command", "archivePath", "directory", "expectedSha256", "expectedBytes",
            "expectedManifestSha256", "operationId")
    fields(request, keys, keys)
    target = absolute(request["directory"])
    if os.path.dirname(target) == target:
        fail("DESTINATION_INVALID")
    digest_string(request["expectedSha256"])
    digest_string(request["expectedManifestSha256"])
    integer(request["expectedBytes"], ARCHIVE_LIMIT, 1)
    identity_string(request["operationId"])
    with Directory(os.path.dirname(target)) as parent:
        name = os.path.basename(target)
        prefix = ".grpc-transfer-receive-" + sha256(utf8(target))
        stage_name = prefix + ".stage"
        archive_path = absolute(request["archivePath"])
        stage_path = os.path.join(parent.path, stage_name)
        if archive_path == stage_path or archive_path.startswith(stage_path + "/"):
            fail("ARCHIVE_INSIDE_STAGE")
        with Guard(parent.fd, prefix + ".lock"), ArchiveSource(archive_path) as archive:
            descriptor = archive.inspect(request)
            binding = receiving_binding(request, descriptor, target)
            existing = accepted_target(parent.fd, name, archive, binding)
            if existing is not None:
                parent.check()
                archive.check()
                return {**descriptor, "directory": target, "receipt": existing,
                        "received": True, "reused": True}
            intent_name = prefix + ".json"
            prior = read_optional(parent.fd, intent_name, 65536)
            if prior is None:
                now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                receipt = {"schema": RECEIVING_SCHEMA, **binding, "receivedAt": now}
                intent = {"schema": "stellar-forge.grpc-workspace-receive-intent.v1",
                          "receipt": receipt, "stage": stage_name,
                          "manifestBytesSha256": sha256(archive.manifest_bytes)}
                immutable_bytes(parent.fd, intent_name, json_bytes(intent))
            else:
                intent = parse_json(prior)
                fields(intent, ("schema", "receipt", "stage", "manifestBytesSha256"),
                       ("schema", "receipt", "stage", "manifestBytesSha256"))
                if (intent["schema"] != "stellar-forge.grpc-workspace-receive-intent.v1" or
                        intent["stage"] != stage_name or
                        intent["manifestBytesSha256"] != sha256(archive.manifest_bytes)):
                    fail("RECEIVING_ID_CONFLICT")
                receipt = validate_receipt(json_bytes(intent["receipt"]), binding)
            stage = child_directory(parent.fd, stage_name, True)
            payload = None
            try:
                with os.scandir(stage) as entries:
                    for item in entries:
                        if item.name not in ("payload", "manifest.publish", "receipt.publish"):
                            fail("RECEIVING_STAGE_CHANGED")
                        info = item.stat(follow_symlinks=False)
                        private(info, item.name == "payload")
                        if item.name != "payload" and info.st_nlink != 1:
                            fail("RECEIVING_STAGE_CHANGED")
                payload = child_directory(stage, "payload", True)
                receipt_data = json_bytes(receipt)
                expected = {restored_path(entry["path"]): entry for entry in archive.manifest["files"]}
                expected[SOURCE_META] = {"bytes": len(archive.manifest_bytes), "sha256": sha256(archive.manifest_bytes)}
                expected[RECEIPT_META] = {"bytes": len(receipt_data), "sha256": sha256(receipt_data)}
                tree_check(payload, expected, partial=True, empty_roots=(OBSERVATIONS,))
                archive.scan(lambda path, entry: ReceivingSink(payload, path, entry))
                publish_payload_metadata(stage, payload, SOURCE_META, archive.manifest_bytes)
                publish_payload_metadata(stage, payload, RECEIPT_META, receipt_data)
                tree_check(payload, expected, check_hashes=True, empty_roots=(OBSERVATIONS,))
                fsync_dir(payload)
                check_fd_name(payload, stage, "payload")
                check_fd_name(stage, parent.fd, stage_name)
                archive.check()
                parent.check()
                try:
                    rename_no_replace(stage, "payload", parent.fd, name)
                    fsync_dir(stage)
                    fsync_dir(parent.fd)
                    reused = False
                except FileExistsError:
                    completed = accepted_target(parent.fd, name, archive, binding)
                    if completed is None:
                        fail("DESTINATION_CHANGED")
                    receipt = completed
                    reused = True
                parent.check()
                completed = accepted_target(parent.fd, name, archive, binding)
                if completed is None:
                    fail("DESTINATION_CHANGED")
                return {**descriptor, "directory": target, "receipt": completed,
                        "received": True, "reused": reused}
            finally:
                if payload is not None:
                    os.close(payload)
                os.close(stage)


def main():
    os.umask(0o077)
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            fail("REQUEST_TOO_LARGE")
        request = parse_json(raw)
        if not isinstance(request, dict):
            fail("REQUEST_INVALID")
        command = request.get("command")
        if command == "pack":
            result = pack(request)
        elif command == "inspect":
            fields(request, ("command", "archivePath", "expectedSha256", "expectedBytes", "expectedManifestSha256"),
                   ("command", "archivePath"))
            with ArchiveSource(request["archivePath"]) as archive:
                result = archive.inspect(request)
        elif command == "receive":
            result = receive(request)
        else:
            fail("COMMAND_INVALID")
        sys.stdout.buffer.write(json_bytes(result))
        sys.stdout.buffer.flush()
        return 0
    except TransferError as issue:
        code = issue.code
    except (gzip.BadGzipFile, tarfile.TarError, EOFError, UnicodeError, zlib.error):
        code = "GRPC_TRANSFER_ARCHIVE_INVALID"
    except OSError as issue:
        code = {errno.ENOSPC: "GRPC_TRANSFER_NO_SPACE",
                errno.EDQUOT: "GRPC_TRANSFER_NO_SPACE",
                errno.ENOENT: "GRPC_TRANSFER_INPUT_MISSING",
                errno.ELOOP: "GRPC_TRANSFER_PATH_INVALID",
                errno.EACCES: "GRPC_TRANSFER_PERMISSION_DENIED",
                errno.ENOTDIR: "GRPC_TRANSFER_PATH_INVALID",
                errno.EEXIST: "GRPC_TRANSFER_DESTINATION_EXISTS"}.get(
                    issue.errno, "GRPC_TRANSFER_IO_FAILED")
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        code = "GRPC_TRANSFER_INPUT_INVALID"
    except Exception:
        code = "GRPC_TRANSFER_HELPER_FAILED"
    sys.stdout.buffer.write(json_bytes({"error": {"code": code, "message": code}}))
    sys.stdout.buffer.flush()
    return 1


if __name__ == "__main__":
    sys.exit(main())
