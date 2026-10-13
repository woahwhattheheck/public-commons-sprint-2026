#!/usr/bin/env python3
"""Receive an exact Git source cache from captured GitData and existing sources.
MIT. The maintained builder remains the package/profile/runtime authority.
"""
from __future__ import annotations
import argparse
from contextlib import ExitStack
import datetime as dt
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import threading
import uuid
import zipfile
import zlib

SCHEMA = "stellar-forge.git-object-receiving.v1"
STATE_SCHEMA = "stellar-forge.git-object-cache.v1"
TRANSFER_SCHEMA = "stellar-forge.git-source-transfer.v1"
PART_SCHEMA = "stellar-forge.git-source-part.v1"
OID = re.compile(r"^[a-f0-9]{40}$")
FILE_LIMIT = 2 * 1024 * 1024
SOURCE_LIMIT = 128 * 1024 * 1024
METADATA_LIMIT = 8 * 1024 * 1024
COMPRESSED_ARCHIVE_LIMIT = 64 * 1024 * 1024
# Payload plus bounded tar headers, padding and skipped original members.
ARCHIVE_STREAM_LIMIT = 256 * 1024 * 1024

class SourceError(Exception):
    pass

def need(value, message):
    if not value:
        raise SourceError(message)

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def object_id(kind, data):
    return hashlib.sha1(f"{kind} {len(data)}\0".encode("ascii") + data).hexdigest()

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")

def regular(path, maximum=FILE_LIMIT, executable=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Expected a bounded regular source file")
        if executable is not None:
            need(bool(before.st_mode & stat.S_IXUSR) == executable,
                 "Existing materialized source executable mode differs: " + str(path))
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(maximum + 1)
        after = os.fstat(fd)
        need(len(data) == before.st_size and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode), "Source file changed during reading")
        return data
    finally:
        os.close(fd)

def absolute_directory(value, exists=True):
    path = Path(value)
    need(path.is_absolute() and str(path) == str(path.absolute()), "Use an absolute source/cache directory")
    need(path.resolve(strict=exists) == path, "Source/cache directories must retain their canonical path")
    if exists:
        need(stat.S_ISDIR(path.lstat().st_mode), "Expected an existing source/cache directory")
    return path

def json_file(path, maximum=METADATA_LIMIT):
    data = regular(path, maximum)
    if data.startswith(b"\x1f\x8b"):
        decoder = zlib.decompressobj(31)
        data = decoder.decompress(data, maximum + 1)
        need(len(data) <= maximum and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
             "Compressed source metadata exceeds its original bounded size")
    return json.loads(data)

def atomic_json(path, value):
    data = canonical(value)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".receiving-tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(fd)
    os.replace(temporary, path)

def validate_metadata(value):
    need(isinstance(value, dict) and value.get("schema") == SCHEMA, "Unsupported Git source receiving schema")
    source = value.get("source")
    tree = value.get("tree")
    commit_text = value.get("commitText")
    need(isinstance(source, dict) and OID.fullmatch(source.get("commit", "")) and
         OID.fullmatch(source.get("tree", "")), "Exact original commit and root tree IDs are required")
    need(isinstance(tree, dict) and tree.get("sha") == source["tree"] and tree.get("truncated") is False and
         isinstance(tree.get("tree"), list), "The complete original recursive tree is required")
    need(isinstance(commit_text, str), "Original commit bytes are required as UTF-8 commitText")
    commit = commit_text.encode("utf-8")
    need(object_id("commit", commit) == source["commit"], "Original Git commit object hash does not match")
    need(commit_text.split("\n", 1)[0] == "tree " + source["tree"], "Commit and recursive root tree differ")
    entries = {}
    groups = {"": []}
    expected_trees = {"": source["tree"]}
    for row in tree["tree"]:
        need(isinstance(row, dict), "Invalid recursive tree row")
        path, mode, kind, oid = (row.get(k) for k in ("path", "mode", "type", "sha"))
        need(isinstance(path, str) and path and "\0" not in path and not path.startswith("/") and
             all(part not in ("", ".", "..") for part in path.split("/")), "Invalid original Git path")
        need(path not in entries and OID.fullmatch(oid or ""), "Duplicate path or invalid original object ID")
        need((kind, mode) in (("tree", "040000"), ("blob", "100644"), ("blob", "100755"),
                              ("blob", "120000"), ("commit", "160000")), "Unsupported original Git tree mode/type")
        entries[path] = row
        parent, _, name = path.rpartition("/")
        groups.setdefault(parent, []).append((name, row))
        if kind == "tree":
            expected_trees[path] = oid
            groups.setdefault(path, [])
    need(set(groups) == set(expected_trees), "Recursive tree omits an intermediate tree")
    objects = []
    for path, rows in groups.items():
        rows.sort(key=lambda item: (item[0] + ("/" if item[1]["type"] == "tree" else "")).encode("utf-8"))
        body = b"".join(
            (row["mode"].lstrip("0") + " " + name).encode("utf-8") + b"\0" + bytes.fromhex(row["sha"])
            for name, row in rows
        )
        need(object_id("tree", body) == expected_trees[path], "Original Git tree object hash does not match: " + path)
        objects.append((expected_trees[path], "tree", body))
    required = value.get("requiredPaths")
    need(isinstance(required, list) and required and len(required) == len(set(required)),
         "Original required source paths must be a nonempty unique list")
    selected = []
    for path in required:
        row = entries.get(path)
        need(row and row["type"] == "blob" and row["mode"] in ("100644", "100755"),
             "Only an original regular source path can be received: " + str(path))
        need(isinstance(row.get("size"), int) and 0 <= row["size"] <= FILE_LIMIT, "Source file exceeds its original limit")
        selected.append(row)
    need(sum(row["size"] for row in selected) <= SOURCE_LIMIT, "Required source exceeds the maintained 128 MiB budget")
    objects.append((source["commit"], "commit", commit))
    return source, entries, selected, objects

def git_command(git, repository, args, **options):
    environment = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    return subprocess.run(
        [git, "--no-replace-objects", "--no-lazy-fetch", "-C", str(repository), *args],
        shell=False, env=environment, **options
    )

class ObjectCache:
    def __init__(self, repository):
        self.repository = repository
        self.written = 0
        self.raw_bytes = 0

    def path(self, oid):
        need(OID.fullmatch(oid) is not None, "Invalid Git object ID")
        return self.repository / "objects" / oid[:2] / oid[2:]

    def read(self, oid, expected_kind=None):
        path = self.path(oid)
        if not path.exists():
            return None
        compressed = regular(path, FILE_LIMIT + 1024 * 1024)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, FILE_LIMIT + 1024 * 1024)
        need(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, "Git object exceeds its bounded original size")
        head, body = raw.split(b"\0", 1)
        kind, size = head.decode("ascii").split(" ")
        need(size == str(len(body)) and object_id(kind, body) == oid, "Cached original Git object changed")
        need(expected_kind is None or kind == expected_kind, "Cached Git object has the wrong type")
        return body

    def write(self, oid, kind, body):
        need(object_id(kind, body) == oid, "Received bytes do not match the original Git object")
        path = self.path(oid)
        path.parent.mkdir(mode=0o700, exist_ok=True)
        if path.exists():
            need(self.read(oid, kind) == body, "Existing immutable Git object differs")
            return False
        raw = f"{kind} {len(body)}\0".encode("ascii") + body
        compressed = zlib.compress(raw)
        temporary = path.parent / ("tmp_obj_" + uuid.uuid4().hex + ".receiving")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb", closefd=False) as handle:
                handle.write(compressed)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                need(self.read(oid, kind) == body, "Concurrent immutable Git object differs")
                return False
        finally:
            os.close(fd)
            temporary.unlink(missing_ok=True)
        self.written += 1
        self.raw_bytes += len(body)
        return True

def receive_git_donor(git, donor, cache, missing):
    """Read batches from an existing object database; never fetch or alter it."""
    ids = list(missing)
    if not ids:
        return 0
    inspected = git_command(git, donor, ["cat-file", "--batch-check"],
                            input=("\n".join(ids) + "\n").encode("ascii"),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    need(inspected.returncode == 0, "Existing Git donor metadata read failed (exit " + str(inspected.returncode) + ")")
    lines = inspected.stdout.decode("ascii").splitlines()
    need(len(lines) == len(ids), "Incomplete original Git donor metadata batch")
    available = []
    for oid, line in zip(ids, lines):
        fields = line.split(" ")
        need(fields[0] == oid, "Original Git donor metadata order changed")
        if fields[1:] == ["missing"]:
            continue
        need(len(fields) == 3 and fields[1] == "blob" and int(fields[2]) == missing[oid]["size"],
             "Original Git donor object metadata differs")
        available.append(oid)
    if not available:
        return 0
    environment = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    process = subprocess.Popen(
        [git, "--no-replace-objects", "--no-lazy-fetch", "-C", str(donor), "cat-file", "--batch"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment, shell=False
    )
    send_error = []
    def send():
        try:
            process.stdin.write(("\n".join(available) + "\n").encode("ascii"))
            process.stdin.close()
        except BaseException as error:
            send_error.append(type(error).__name__)
    sender = threading.Thread(target=send, daemon=True)
    sender.start()
    received = 0
    try:
        for oid in available:
            header = process.stdout.readline(160).decode("ascii").rstrip("\n").split(" ")
            need(len(header) == 3 and header[0] == oid and header[1] == "blob" and
                 int(header[2]) == missing[oid]["size"], "Original donor content header changed")
            size = int(header[2])
            body = process.stdout.read(size)
            need(len(body) == size and process.stdout.read(1) == b"\n", "Original donor content was truncated")
            cache.write(oid, "blob", body)
            del missing[oid]
            received += 1
        need(process.stdout.read(1) == b"", "Unexpected extra original donor content")
        sender.join(timeout=10)
        need(not sender.is_alive() and not send_error and process.wait(timeout=10) == 0, "Original donor batch did not finish")
        return received
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()

def receive_files(directory, selected, cache, missing, flat=False):
    received = 0
    for row in selected:
        oid = row["sha"]
        if oid not in missing:
            continue
        path = directory / (oid + ".blob") if flat else directory / row["path"]
        compressed_path = directory / (oid + ".blob.gz") if flat else None
        try:
            if compressed_path is not None and compressed_path.exists():
                packed = regular(compressed_path, FILE_LIMIT + 65536)
                decoder = zlib.decompressobj(31)
                data = decoder.decompress(packed, FILE_LIMIT + 1)
                need(len(data) <= FILE_LIMIT and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
                     "Received compressed blob exceeds its original source limit")
            else:
                data = regular(path)
        except FileNotFoundError:
            continue
        except OSError as error:
            if error.errno == 40:  # O_NOFOLLOW rejects source aliases.
                continue
            raise
        if len(data) != row["size"] or object_id("blob", data) != oid:
            continue
        cache.write(oid, "blob", data)
        del missing[oid]
        received += 1
    return received

class ArchiveStream:
    """Limit expanded tar bytes, including names, headers and skipped members."""
    def __init__(self, source):
        self.source = source
        self.bytes = 0

    def read(self, size=-1):
        remaining = ARCHIVE_STREAM_LIMIT - self.bytes
        requested = remaining + 1 if size is None or size < 0 else min(size, remaining + 1)
        data = self.source.read(min(requested, 65536))
        self.bytes += len(data)
        need(self.bytes <= ARCHIVE_STREAM_LIMIT, "Expanded source archive exceeds 256 MiB")
        return data

def receive_archive(expected_sha256, filename, cache, missing):
    """Read exact blobs directly from an existing pinned tar.gz release."""
    need(re.fullmatch(r"[a-f0-9]{64}", expected_sha256 or "") is not None,
         "An original archive SHA-256 is required")
    path = Path(filename)
    need(path.is_absolute() and path.resolve(strict=True) == path,
         "Use the original absolute regular archive path")
    need(stat.S_ISREG(path.lstat().st_mode), "Source archive must be a regular file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= COMPRESSED_ARCHIVE_LIMIT,
             "Compressed source archive exceeds 64 MiB")
        digest = hashlib.sha256()
        hashed_bytes = 0
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hashed_bytes += len(block)
            need(hashed_bytes <= before.st_size, "Original source archive grew during hashing")
            digest.update(block)
        need(hashed_bytes == before.st_size, "Original source archive changed during hashing")
        need(digest.hexdigest() == expected_sha256, "Original source archive digest differs")
        stream.seek(0)
        sizes = {row["size"] for row in missing.values()}
        received = 0
        regular_members = 0
        with gzip.GzipFile(fileobj=stream, mode="rb") as expanded:
            bounded = ArchiveStream(expanded)
            with tarfile.open(fileobj=bounded, mode="r|") as archive:
                for member in archive:
                    # Names and link targets never become filesystem paths.
                    if not member.isfile():
                        continue
                    regular_members += 1
                    need(member.size >= 0, "Negative original archive member size")
                    if not missing or member.size not in sizes or member.size > FILE_LIMIT:
                        continue
                    handle = archive.extractfile(member)
                    need(handle is not None, "Original archive member could not be read")
                    with handle:
                        data = handle.read(FILE_LIMIT + 1)
                    need(len(data) == member.size, "Original archive member was truncated")
                    oid = object_id("blob", data)
                    row = missing.get(oid)
                    if row is None or row["size"] != len(data):
                        continue
                    cache.write(oid, "blob", data)
                    del missing[oid]
                    received += 1
            # Consume the original compressed member through its checksum even
            # after tar's end marker, without retaining expanded bytes.
            while bounded.read(65536):
                pass
        after = os.fstat(stream.fileno())
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
             "Original source archive changed during reading")
    return {"kind": "original-release-archive", "archive": str(path),
            "sha256": expected_sha256, "archiveBytes": before.st_size,
            "expandedBytes": bounded.bytes, "regularMembers": regular_members,
            "objects": received}

def bounded_integer(value, maximum, label, minimum=0):
    need(type(value) is int and minimum <= value <= maximum, "Invalid " + label)
    return value

def source_path(value):
    need(isinstance(value, str) and value and "\0" not in value and "\\" not in value and
         not value.startswith("/") and all(part not in ("", ".", "..") for part in value.split("/")),
         "Source transfer requires a relative POSIX path")
    return value

def source_file_state(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

def carrier_tree(files):
    """Reconstruct the carrier root without creating archive member paths."""
    groups = {"": {}}
    for path, (mode, oid) in files.items():
        source_path(path)
        parts = path.split("/")
        for depth in range(1, len(parts)):
            groups.setdefault("/".join(parts[:depth]), {})
        parent, _, name = path.rpartition("/")
        need(name not in groups[parent], "Duplicate source carrier entry")
        groups[parent][name] = (mode, oid)
    roots = {}
    for parent in sorted(groups, key=lambda path: (path.count("/"), len(path)), reverse=True):
        rows = groups[parent]
        body = b"".join(
            (mode.lstrip("0") + " " + name).encode("utf-8") + b"\0" + bytes.fromhex(oid)
            for name, (mode, oid) in sorted(
                rows.items(), key=lambda item: (item[0] + ("/" if item[1][0] == "040000" else "")).encode("utf-8"))
        )
        roots[parent] = object_id("tree", body)
        if parent:
            ancestor, _, name = parent.rpartition("/")
            need(name not in groups[ancestor], "Source carrier path is both a file and a directory")
            groups[ancestor][name] = ("040000", roots[parent])
    return roots[""]

def github_commit_text(commit, source):
    need(isinstance(commit, dict) and commit.get("sha") == source["commit"] and
         isinstance(commit.get("tree"), dict) and commit["tree"].get("sha") == source["tree"],
         "Original Git commit authority differs from the selected source")
    candidates = []
    if isinstance(commit.get("commitText"), str):
        candidates.append(commit["commitText"])
    verification = commit.get("verification")
    if isinstance(verification, dict) and isinstance(verification.get("payload"), str):
        payload = verification["payload"]
        signature = verification.get("signature")
        if isinstance(signature, str) and signature:
            head, separator, message = payload.partition("\n\n")
            need(separator and "\ngpgsig " not in head, "Malformed original signed commit payload")
            # GitHub retains a final signature newline as a blank continuation
            # line. Preserve it; accept a normalized variant only by original SHA.
            for exact_signature in dict.fromkeys((signature, signature.removesuffix("\n"))):
                candidates.append(head + "\ngpgsig " + exact_signature.replace("\n", "\n ") +
                                  "\n\n" + message)
        else:
            candidates.append(payload)
    for candidate in candidates:
        if object_id("commit", candidate.encode("utf-8")) == source["commit"]:
            return candidate
    raise SourceError("Original commit bytes are unavailable: capture exact commitText or the original signed GitHub payload")

class SourcePart:
    """One pinned ZIP; member names remain in memory and never become paths."""
    def __init__(self, stack, directory, record, source, count):
        self.record = record
        relative = source_path(record.get("path"))
        path = directory / relative
        need(path.resolve(strict=True) == path, "Source part path must retain its canonical location")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        self.stream = stack.enter_context(os.fdopen(fd, "rb"))
        self.path = path
        self.before = os.fstat(fd)
        expected_bytes = bounded_integer(record.get("archiveBytes"), COMPRESSED_ARCHIVE_LIMIT,
                                         "source ZIP byte length", minimum=1)
        need(stat.S_ISREG(self.before.st_mode) and self.before.st_size == expected_bytes,
             "Source ZIP size differs from the captured transfer")
        digest = hashlib.sha256()
        consumed = 0
        for block in iter(lambda: self.stream.read(1024 * 1024), b""):
            consumed += len(block)
            need(consumed <= expected_bytes, "Source ZIP grew during hashing")
            digest.update(block)
        need(consumed == expected_bytes, "Source ZIP was truncated during hashing")
        self.sha256 = digest.hexdigest()
        if record.get("archiveSha256") is not None:
            need(record["archiveSha256"] == self.sha256, "Source ZIP digest differs from its pinned receipt")
        self.unchanged()
        self.stream.seek(0)
        self.archive = stack.enter_context(zipfile.ZipFile(self.stream, mode="r"))
        items = self.archive.infolist()
        need(1 <= len(items) <= 50000, "Source ZIP has an invalid member count")
        names = set()
        roots = set()
        self.files = {}
        directories = set()
        expanded_bytes = 0
        for item in items:
            need(item.orig_filename == item.filename and "\0" not in item.filename,
                 "Source ZIP member name was truncated")
            name = item.filename.removesuffix("/") if item.is_dir() else item.filename
            source_path(name)
            need(item.filename not in names and not item.flag_bits & 1,
                 "Source ZIP contains duplicate or encrypted members")
            names.add(item.filename)
            need(item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                 "Unsupported source ZIP compression")
            expanded_bytes += item.file_size
            need(item.file_size >= 0 and expanded_bytes <= SOURCE_LIMIT + METADATA_LIMIT,
                 "Expanded source ZIP exceeds the original source budget")
            wrapper, separator, member = name.partition("/")
            roots.add(wrapper)
            mode = item.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if item.is_dir():
                need(kind in (0, stat.S_IFDIR) and item.file_size == 0, "Source ZIP directory changed type")
                directories.add(member if separator else "")
                continue
            need(separator and member and kind in (0, stat.S_IFREG),
                 "Source ZIP must contain regular files under one wrapper directory")
            need(member not in self.files, "Duplicate normalized source ZIP path")
            self.files[member] = item
        need(len(roots) == 1 and "SOURCE-PART.json" in self.files,
             "Source ZIP requires one original carrier wrapper and manifest")
        allowed_directories = {""}
        for name in self.files:
            components = name.split("/")
            allowed_directories.update("/".join(components[:depth]) for depth in range(1, len(components)))
        need(directories <= allowed_directories, "Source ZIP contains undeclared directory entries")
        manifest_size = bounded_integer(record.get("manifestBytes"), METADATA_LIMIT, "source manifest size", minimum=1)
        raw = self.read("SOURCE-PART.json", manifest_size, METADATA_LIMIT, "100644")
        need(object_id("blob", raw) == record["manifestGitBlob"] and
             hashlib.sha256(raw).hexdigest() == record["manifestSha256"],
             "Source part manifest differs from the captured Git object")
        self.manifest = json.loads(raw)
        manifest = self.manifest
        need(isinstance(manifest, dict) and manifest.get("schema") == PART_SCHEMA and
             manifest.get("source") == source and manifest.get("part") == record["part"] and
             manifest.get("parts") == count and manifest.get("kind") == record["kind"] and
             isinstance(manifest.get("members"), list), "Source part belongs to a different original transfer")
        self.carrier_files = {"SOURCE-PART.json": ("100644", record["manifestGitBlob"])}
        self.authorities = {}
        expected_files = {"SOURCE-PART.json"}
        if record["kind"] == "git-authority":
            need(manifest["members"] == [] and isinstance(manifest.get("authorities"), list) and
                 len(manifest["authorities"]) == 2, "Original source authority part is incomplete")
            expected_authorities = {"SOURCE-COMMIT.json": "github-git-commit-response",
                                    "SOURCE-TREE.json": "github-recursive-git-tree-response"}
            for authority in manifest["authorities"]:
                need(isinstance(authority, dict), "Malformed source authority")
                name = authority.get("path")
                need(name in expected_authorities and name not in self.authorities and
                     authority.get("kind") == expected_authorities[name], "Unexpected source authority")
                size = bounded_integer(authority.get("bytes"), METADATA_LIMIT, "source authority size", minimum=1)
                body = self.read(name, size, METADATA_LIMIT, "100644")
                need(hashlib.sha256(body).hexdigest() == authority.get("sha256"), "Original source authority digest differs")
                self.authorities[name] = json.loads(body)
                self.carrier_files[name] = ("100644", object_id("blob", body))
                expected_files.add(name)
        else:
            need(not manifest.get("authorities"), "Source data part cannot replace original authority")
            for member in manifest["members"]:
                need(isinstance(member, dict), "Malformed original source member")
                name = source_path(member.get("path"))
                need(name not in expected_files and member.get("mode") in ("100644", "100755") and
                     isinstance(member.get("gitBlob"), str) and OID.fullmatch(member["gitBlob"]),
                     "Duplicate or unsupported original source member")
                bounded_integer(member.get("bytes"), FILE_LIMIT, "original source member size")
                expected_files.add(name)
                self.carrier_files[name] = (member["mode"], member["gitBlob"])
        need(set(self.files) == expected_files, "Source ZIP file membership differs from its manifest")
        need(carrier_tree(self.carrier_files) == record["carrierTree"], "Source carrier Git tree differs")
        need(record["sourceFiles"] == len(manifest["members"]) and
             record["sourceBytes"] == sum(member["bytes"] for member in manifest["members"]),
             "Source part totals differ from the transfer index")

    def unchanged(self):
        need(source_file_state(self.before) == source_file_state(os.fstat(self.stream.fileno())),
             "Source ZIP changed while it was being received")

    def read(self, name, expected_size, maximum, mode):
        item = self.files.get(name)
        need(item is not None and item.file_size == expected_size and expected_size <= maximum,
             "Source ZIP member size differs: " + name)
        unix_mode = item.external_attr >> 16
        if item.create_system == 3 and unix_mode:
            need(stat.S_IMODE(unix_mode) == (0o755 if mode == "100755" else 0o644),
                 "Source ZIP executable mode differs: " + name)
        with self.archive.open(item, mode="r") as stream:
            body = stream.read(maximum + 1)
        need(len(body) == expected_size, "Source ZIP member was truncated: " + name)
        return body

    def receive(self, cache, missing):
        count = 0
        for member in self.manifest["members"]:
            body = self.read(member["path"], member["bytes"], FILE_LIMIT, member["mode"])
            oid = member["gitBlob"]
            need(object_id("blob", body) == oid, "Source ZIP bytes differ from original Git object: " + member["path"])
            if cache.write(oid, "blob", body):
                count += 1
            missing.pop(oid, None)
        self.unchanged()
        return {"part": self.record["part"], "kind": self.record["kind"],
                "archive": str(self.path), "archiveBytes": self.before.st_size, "sha256": self.sha256,
                "carrierCommit": self.record["carrierCommit"], "carrierTree": self.record["carrierTree"],
                "manifestGitBlob": self.record["manifestGitBlob"],
                "sourceFiles": self.record["sourceFiles"], "sourceBytes": self.record["sourceBytes"],
                "objects": count, "phase": "OBJECTS_RECEIVED"}

class SourceTransfer:
    def __init__(self, filename):
        self.stack = ExitStack()
        try:
            index_path = Path(filename)
            need(index_path.is_absolute() and index_path.resolve(strict=True) == index_path,
                 "Use the original absolute source transfer index path")
            index_bytes = regular(index_path, METADATA_LIMIT)
            self.index = json.loads(index_bytes)
            index = self.index
            need(isinstance(index, dict) and index.get("schema") == TRANSFER_SCHEMA,
                 "Unsupported source transfer index schema")
            source = index.get("source")
            records = index.get("parts")
            need(isinstance(source, dict) and isinstance(source.get("repository"), str) and
                 re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", source["repository"]) and
                 isinstance(source.get("commit"), str) and OID.fullmatch(source["commit"]) and
                 isinstance(source.get("tree"), str) and OID.fullmatch(source["tree"]),
                 "Source transfer requires the exact original repository, commit and tree")
            bounded_integer(source.get("fileCount"), 50000, "original source file count", minimum=1)
            bounded_integer(source.get("sourceBytes"), SOURCE_LIMIT, "original source byte count")
            need(isinstance(records, list) and 1 <= len(records) <= 1000,
                 "Source transfer requires its complete part index")
            paths = set()
            for number, record in enumerate(records, 1):
                need(isinstance(record, dict) and type(record.get("part")) is int and record["part"] == number and
                     record.get("kind") in ("git-authority", "source-files"), "Source transfer parts must be contiguous and ordered")
                name = source_path(record.get("path"))
                need(name not in paths, "Source transfer reuses an archive path")
                paths.add(name)
                for key in ("carrierCommit", "carrierTree", "manifestGitBlob"):
                    need(isinstance(record.get(key), str) and OID.fullmatch(record[key]),
                         "Source transfer requires an exact " + key)
                need(isinstance(record.get("manifestSha256"), str) and
                     re.fullmatch(r"[a-f0-9]{64}", record["manifestSha256"]),
                     "Source transfer requires the exact manifest SHA-256")
                bounded_integer(record.get("sourceFiles"), source["fileCount"], "source part file count")
                bounded_integer(record.get("sourceBytes"), source["sourceBytes"], "source part byte count")
            need(sum(record["kind"] == "git-authority" for record in records) == 1 and
                 records[0]["kind"] == "git-authority", "The first and only authority part must retain the original Git metadata")
            self.parts = [SourcePart(self.stack, index_path.parent, record, source, len(records)) for record in records]
            authority = self.parts[0].authorities
            tree = authority["SOURCE-TREE.json"]
            need(isinstance(tree, dict) and isinstance(tree.get("tree"), list), "Malformed original recursive source tree")
            rows = tree["tree"]
            regular_rows = [row for row in rows if isinstance(row, dict) and row.get("type") == "blob" and
                            row.get("mode") in ("100644", "100755")]
            need(all(isinstance(row, dict) and (row.get("type") == "tree" or
                     (row.get("type") == "blob" and row.get("mode") in ("100644", "100755"))) for row in rows),
                 "This source transfer must retain only original regular files and directories")
            need(len(regular_rows) == source["fileCount"] and
                 all(type(row.get("size")) is int and 0 <= row["size"] <= FILE_LIMIT for row in regular_rows) and
                 sum(row["size"] for row in regular_rows) == source["sourceBytes"],
                 "Complete original source totals differ from the transfer")
            self.metadata = {"schema": SCHEMA, "source": source, "tree": tree,
                             "commitText": github_commit_text(authority["SOURCE-COMMIT.json"], source),
                             "requiredPaths": [row["path"] for row in regular_rows]}
            _, entries, _, _ = validate_metadata(self.metadata)
            declared = set()
            for part in self.parts:
                for member in part.manifest["members"]:
                    path = member["path"]
                    row = entries.get(path)
                    need(path not in declared and row is not None and
                         (row["mode"], row["sha"], row.get("size")) ==
                         (member["mode"], member["gitBlob"], member["bytes"]),
                         "Source part duplicates or changes an original source path: " + path)
                    declared.add(path)
            need(declared == set(self.metadata["requiredPaths"]), "Source transfer omits original files")
            self.identity = hashlib.sha256(index_bytes).hexdigest()
        except BaseException:
            self.stack.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *details):
        return self.stack.__exit__(*details)

def materialize(directory, selected, cache):
    directory = absolute_directory(directory, exists=False)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    materialized = 0
    for row in selected:
        data = cache.read(row["sha"], "blob")
        need(data is not None, "Receive the complete requested closure before materializing it")
        path = directory / row["path"]
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        need(path.parent.resolve() == path.parent, "Materialized source directory was redirected")
        if path.exists():
            need(regular(path, executable=row["mode"] == "100755") == data,
                 "Existing source postimage differs: " + row["path"])
            continue
        temporary = path.with_name(".receiving-" + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o755 if row["mode"] == "100755" else 0o644)
        try:
            os.fchmod(fd, 0o755 if row["mode"] == "100755" else 0o644)
            with os.fdopen(fd, "wb", closefd=False) as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                need(regular(path, executable=row["mode"] == "100755") == data,
                     "Concurrent original source postimage differs")
        finally:
            os.close(fd)
            temporary.unlink(missing_ok=True)
        materialized += 1
    return materialized

def receive_metadata(args, metadata, transfer=None):
    source, entries, selected, objects = validate_metadata(metadata)
    need(args.commit == source["commit"], "The explicit selected commit differs from the captured source")
    metadata_hash = hashlib.sha256(canonical(metadata)).hexdigest()
    directory = absolute_directory(args.directory, exists=False)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = os.open(directory / "source-receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_file = directory / "source-receiving.json"
        previous = json_file(state_file) if state_file.exists() else None
        if previous:
            need(previous.get("schema") == STATE_SCHEMA and previous.get("directory") == str(directory) and
                 previous.get("source") == source and previous.get("metadataSha256") == metadata_hash,
                 "Resume the original cache with its exact original source metadata")
        else:
            need(not any(p.name != "source-receiving.lock" for p in directory.iterdir()),
                 "Create an owned cache directory or resume its original receiving record")
            previous = {"schema": STATE_SCHEMA, "directory": str(directory), "source": source,
                        "metadataSha256": metadata_hash, "createdAt": now(), "phase": "RECEIVING"}
            atomic_json(state_file, previous)
        if transfer is not None:
            retained = previous.get("sourceTransfer")
            need(retained is None or (isinstance(retained, dict) and
                 retained.get("schema") == TRANSFER_SCHEMA and retained.get("indexSha256") == transfer.identity),
                 "Resume this source cache with its original transfer index")
            previous["sourceTransfer"] = retained or {"schema": TRANSFER_SCHEMA,
                "indexSha256": transfer.identity, "source": source, "parts": []}
            atomic_json(state_file, previous)
        repository = directory / "repository.git"
        if not repository.exists():
            started = subprocess.run([args.git, "init", "--bare", "--quiet", str(repository)],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False, timeout=30)
            need(started.returncode == 0, "Could not initialize the owned Git object cache")
        additional = list(dict.fromkeys([*(previous.get("additionalPaths") or []), *args.additional_path]))
        selected_paths = {row["path"] for row in selected}
        for path in additional:
            row = entries.get(path)
            need(row and row["type"] == "blob" and row["mode"] in ("100644", "100755") and
                 isinstance(row.get("size"), int) and 0 <= row["size"] <= FILE_LIMIT,
                 "Additional closure path must be an original regular source file")
            if path not in selected_paths:
                selected.append(row)
                selected_paths.add(path)
        need(sum(row["size"] for row in selected) <= SOURCE_LIMIT, "Expanded source exceeds the maintained 128 MiB budget")
        cache = ObjectCache(repository)
        # Interrupted writes leave only our unreferenced temporary objects.
        for temporary in (repository / "objects").glob("??/tmp_obj_*.receiving"):
            need(stat.S_ISREG(temporary.lstat().st_mode), "Interrupted source temporary changed type")
            temporary.unlink()
        for oid, kind, body in objects:
            cache.write(oid, kind, body)
        # This is a shallow object cache for one immutable commit, with full tree
        # metadata and the requested native source blobs. Its parents remain exact.
        (repository / "shallow").write_text(source["commit"] + "\n", encoding="ascii")
        updated = git_command(args.git, repository, ["update-ref", "refs/heads/source", source["commit"]],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        need(updated.returncode == 0, "The owned Git cache requires Git with --no-lazy-fetch support")
        missing = {}
        for row in selected:
            if cache.read(row["sha"], "blob") is None:
                missing[row["sha"]] = {"sha": row["sha"], "size": row["size"], "paths": []}
        for row in selected:
            if row["sha"] in missing:
                missing[row["sha"]]["paths"].append(row["path"])
        donors = []
        for name in args.donor_repository:
            donor = absolute_directory(name)
            count = receive_git_donor(args.git, donor, cache, missing)
            donors.append({"kind": "original-git", "directory": str(donor), "objects": count})
        for name in args.donor_source:
            donor = absolute_directory(name)
            count = receive_files(donor, selected, cache, missing)
            donors.append({"kind": "original-source", "directory": str(donor), "objects": count})
        for expected_sha256, filename in getattr(args, "donor_archive", []):
            donors.append(receive_archive(expected_sha256, filename, cache, missing))
        for name in args.incoming:
            donor = absolute_directory(name)
            count = receive_files(donor, selected, cache, missing, flat=True)
            donors.append({"kind": "received-blobs", "directory": str(donor), "objects": count})
        if transfer is not None:
            retained_parts = {row["part"]: row for row in previous["sourceTransfer"]["parts"]}
            for part in transfer.parts:
                retained = retained_parts.get(part.record["part"])
                need(retained is None or retained.get("sha256") == part.sha256,
                     "Retain the original source archive bytes when resuming this transfer")
                receipt = part.receive(cache, missing)
                if retained is not None:
                    receipt["firstReceivedAt"] = retained["firstReceivedAt"]
                else:
                    receipt["firstReceivedAt"] = now()
                retained_parts[receipt["part"]] = receipt
                previous["sourceTransfer"]["parts"] = [retained_parts[number] for number in sorted(retained_parts)]
                previous["updatedAt"] = now()
                previous["phase"] = "RECEIVING"
                atomic_json(state_file, previous)
                donors.append({"kind": "source-transfer-part", "part": receipt["part"], "objects": receipt["objects"]})
        listed = git_command(args.git, repository, ["ls-tree", "-r", "-z", "--full-tree", source["commit"]],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        need(listed.returncode == 0, "Original Git could not enumerate the recovered source tree")
        actual = {}
        for line in listed.stdout.split(b"\0"):
            if not line:
                continue
            fields, path = line.split(b"\t", 1)
            mode, kind, oid = fields.decode("ascii").split(" ")
            actual[path.decode("utf-8")] = (mode, kind, oid)
        expected = {path: (row["mode"], row["type"], row["sha"])
                    for path, row in entries.items() if row["type"] != "tree"}
        need(actual == expected, "Git enumerated a different source tree")
        result = {**previous, "phase": "SOURCE_NEEDED" if missing else "OBJECTS_AVAILABLE",
                  "updatedAt": now(), "repository": str(repository), "gitTreeEntries": len(actual),
                  "verifiedTreeObjects": sum(kind == "tree" for _, kind, _ in objects),
                  "requiredPaths": len(selected), "requiredBytes": sum(row["size"] for row in selected),
                  "additionalPaths": additional,
                  "writtenObjects": cache.written, "writtenRawBytes": cache.raw_bytes, "donors": donors,
                  "missingObjects": len(missing), "missingBytes": sum(row["size"] for row in missing.values())}
        atomic_json(directory / "missing-objects.json", {"source": source, "objects": list(missing.values())})
        if args.materialize and not missing:
            result["materializedFiles"] = materialize(args.materialize, selected, cache)
            result["sourceDirectory"] = str(Path(args.materialize))
        atomic_json(state_file, result)
        print(json.dumps(result, separators=(",", ":")))
        return 2 if missing else 0
    finally:
        os.close(lock)

def receive(args):
    if args.source_transfer:
        with SourceTransfer(args.source_transfer) as transfer:
            return receive_metadata(args, transfer.metadata, transfer)
    return receive_metadata(args, json_file(Path(args.metadata)))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    original_source = parser.add_mutually_exclusive_group(required=True)
    original_source.add_argument("--metadata", help="Complete captured GitData tree and exact commitText")
    original_source.add_argument("--source-transfer", help="Original complete source-part index beside its ZIP files")
    parser.add_argument("--commit", required=True, help="Explicit immutable original Git commit")
    parser.add_argument("--directory", required=True, help="New or original owned source-cache directory")
    parser.add_argument("--git", default="git", help="Existing Git executable with --no-lazy-fetch support")
    parser.add_argument("--donor-repository", action="append", default=[], help="Existing Git database, read only")
    parser.add_argument("--donor-source", action="append", default=[], help="Existing native source root, read only")
    parser.add_argument("--donor-archive", action="append", nargs=2, default=[], metavar=("SHA256", "PATH"),
                        help="Existing original tar.gz release digest and absolute path, read only")
    parser.add_argument("--incoming", action="append", default=[], help="Exact received blobs named OID.blob or OID.blob.gz")
    parser.add_argument("--materialize", help="New native source directory for the complete requested closure")
    parser.add_argument("--additional-path", action="append", default=[], help="Exact source path subsequently requested by the maintained builder")
    args = parser.parse_args()
    try:
        return receive(args)
    except (SourceError, OSError, ValueError, EOFError, tarfile.TarError, zipfile.BadZipFile, zlib.error, subprocess.SubprocessError) as error:
        print(json.dumps({"phase": "ERROR", "code": type(error).__name__, "message": str(error)[:1200]}),
              file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
