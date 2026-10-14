#!/usr/bin/env python3
"""Receive exact retained source objects without extracting entire archives.

The request and packet formats are the existing commons.original-source-*
formats used by the native geographic intake. Standard-library only. No source
code, installers, network requests or scientific models are executed.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import dataclasses
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import shutil
import stat
import sys
import tempfile
import time
from typing import Any, BinaryIO, Iterator
import zipfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_tools import original_object_io as object_io

VERSION = "1.1.0"
REQUEST = "commons.original-source-missing-objects-request/v1"
PACKET = "commons.original-source-objects/v1"
BLOCK = 192 * 1024  # Divisible by three for streaming, canonical Base64.
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
BASE64 = re.compile(rb"[A-Za-z0-9+/]*={0,2}\Z")


class TransferError(ValueError):
    """An actionable source or receiving failure; existing originals survive."""


def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise TransferError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def valid_hash(value: Any) -> str:
    if not isinstance(value, str) or not DIGEST.fullmatch(value):
        raise TransferError("Expected a lowercase SHA-256 identity")
    return value


def natural(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise TransferError(name + " must be a nonnegative integer")
    return value


def relative(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise TransferError("Invalid original relative path")
    p = PurePosixPath(value)
    if not p.parts or p.is_absolute() or str(p) != value or any(x in (".", "..") for x in p.parts):
        raise TransferError("Unsafe original relative path: " + repr(value))
    if ":" in p.parts[0] or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in value):
        raise TransferError("Nonportable original path: " + repr(value))
    return value


def signature(path: Path) -> tuple[int, int, int, int, int]:
    s = object_io.file_stat(object_io.native(path))
    if not stat.S_ISREG(s.st_mode):
        raise TransferError("Expected a regular nonsymlink file: " + str(path))
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


@contextlib.contextmanager
def regular(path: Path) -> Iterator[BinaryIO]:
    before = signature(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(object_io.open_file(object_io.native(path), flags), "rb") as stream:
        s = object_io.fd_stat(stream.fileno())
        opened = (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if before != opened:
            raise TransferError("Source changed while opening: " + str(path))
        yield stream
        if signature(path) != before:
            raise TransferError("Source changed while reading: " + str(path))


def hash_stream(stream: BinaryIO) -> tuple[int, str]:
    size, h = 0, hashlib.sha256()
    while block := stream.read(BLOCK):
        h.update(block)
        size += len(block)
    return size, h.hexdigest()


def hash_file(path: Path) -> tuple[int, str]:
    with regular(path) as stream:
        return hash_stream(stream)


def write_json(path: Path, value: Any) -> None:
    """Replace this operation's report after closing its flushed temporary file."""
    path = object_io.native(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".report-", delete=False) as f:
            pending = Path(f.name)
            f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
        object_io.replace(pending, path)
        object_io.sync_directory(path.parent)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def validate_objects(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        raise TransferError("objects must be an array")
    result, seen, destinations = [], set(), {}
    for row in rows:
        if not isinstance(row, dict):
            raise TransferError("Each object must declare bytes, sha256 and paths")
        identity = valid_hash(row.get("sha256"))
        size = natural(row.get("bytes"), "bytes")
        paths = row.get("paths")
        if identity in seen or not isinstance(paths, list) or not paths:
            raise TransferError("Repeated identity or empty original path list")
        seen.add(identity)
        names = [relative(p) for p in paths]
        for name in names:
            if name in destinations:
                raise TransferError("Repeated logical destination: " + name)
            destinations[name] = identity
        result.append({"sha256": identity, "bytes": size, "paths": names})
    for name in destinations:
        for p in PurePosixPath(name).parents:
            if str(p) in destinations:
                raise TransferError("A source file is also a parent directory: " + str(p))
    return result


def read_request(path: Path, expected: str | None = None) -> tuple[dict[str, Any], str]:
    with regular(path) as f:
        body = f.read()
    identity = sha(body)
    if expected and identity != valid_hash(expected):
        raise TransferError("Request bytes do not match the supplied SHA-256")
    doc = json.loads(body, object_pairs_hook=pairs)
    if not isinstance(doc, dict) or doc.get("schema") != REQUEST:
        raise TransferError("Use " + REQUEST)
    doc["objects"] = validate_objects(doc.get("objects"))
    if natural(doc.get("objects_count"), "objects_count") != len(doc["objects"]):
        raise TransferError("Request object count differs")
    if natural(doc.get("unique_bytes"), "unique_bytes") != sum(x["bytes"] for x in doc["objects"]):
        raise TransferError("Request unique byte total differs")
    return doc, identity


@dataclasses.dataclass(frozen=True)
class Candidate:
    source: str
    member: str | None
    ordinal: int | None
    source_signature: tuple[int, int, int, int, int]
    bytes: int
    sha256: str

    @contextlib.contextmanager
    def open(self, stack: contextlib.ExitStack | None = None,
             archives: dict[str, zipfile.ZipFile] | None = None) -> Iterator[BinaryIO]:
        path = Path(self.source)
        if signature(path) != tuple(self.source_signature):
            raise TransferError("Retained input changed; rescan " + str(path))
        if self.member is not None and stack is not None and archives is not None:
            if self.source not in archives:
                outer = stack.enter_context(regular(path))
                archives[self.source] = stack.enter_context(zipfile.ZipFile(outer))
            items = archives[self.source].infolist()
            if self.ordinal is None or self.ordinal >= len(items):
                raise TransferError("Retained archive member disappeared")
            item = items[self.ordinal]
            if item.filename != self.member or item.file_size != self.bytes:
                raise TransferError("Retained archive member identity changed")
            with archives[self.source].open(item) as inner:
                yield inner
            return
        with regular(path) as outer:
            if self.member is None:
                yield outer
            else:
                with zipfile.ZipFile(outer) as archive:
                    items = archive.infolist()
                    if self.ordinal is None or self.ordinal >= len(items):
                        raise TransferError("Retained archive member disappeared")
                    item = items[self.ordinal]
                    if item.filename != self.member or item.file_size != self.bytes:
                        raise TransferError("Retained archive member identity changed")
                    with archive.open(item) as inner:
                        yield inner


class SourceIndex:
    """Disk-backed byte identities. Every chosen body is rehashed at export."""
    def __init__(self, path: Path):
        path = object_io.native(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=30000")
        self.db.execute("""CREATE TABLE IF NOT EXISTS members (
            source TEXT NOT NULL, signature TEXT NOT NULL, ordinal INTEGER NOT NULL,
            member TEXT, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
            PRIMARY KEY(source,signature,ordinal))""")
        self.db.execute("CREATE INDEX IF NOT EXISTS hashes ON members(sha256,bytes)")
        self.db.commit()
        self.stats = {"hashed_bytes": 0, "hashed_members": 0, "reused_members": 0,
                      "examined_members": 0, "skipped_symlinks": 0}

    def close(self) -> None:
        self.db.close()

    def _hash(self, source: Path, sig: tuple, ordinal: int, member: str | None,
              size: int, opener: Any) -> Candidate:
        key = json.dumps(sig)
        old = self.db.execute("SELECT sha256 FROM members WHERE source=? AND signature=? AND ordinal=?",
                              (str(source), key, ordinal)).fetchone()
        if old:
            identity = old[0]
            self.stats["reused_members"] += 1
        else:
            with opener() as stream:
                actual, identity = hash_stream(stream)
            if actual != size or signature(source) != sig:
                raise TransferError("Retained object changed during scan: " + str(source))
            self.db.execute("INSERT OR REPLACE INTO members VALUES (?,?,?,?,?,?)",
                            (str(source), key, ordinal, member, size, identity))
            self.db.commit()  # Each completed member survives an interrupted scan.
            self.stats["hashed_bytes"] += actual
            self.stats["hashed_members"] += 1
        return Candidate(str(source), member, None if ordinal == -1 else ordinal,
                         sig, size, identity)

    def scan(self, roots: list[Path], rows: list[dict[str, Any]]) -> dict[str, Candidate]:
        wanted = {x["sha256"]: x["bytes"] for x in rows}
        sizes = set(wanted.values())
        found: dict[str, Candidate] = {}
        for root in roots:
            root = object_io.native(root)
            if object_io.is_link(root):
                raise TransferError("Retained root must not be a symlink: " + str(root))
            root = root.resolve(strict=True)
            if root.is_dir():
                for directory, dirs, files in os.walk(root, followlinks=False):
                    dirs[:] = sorted(d for d in dirs if not object_io.is_link(Path(directory) / d))
                    for name in sorted(files):
                        p = Path(directory) / name
                        if object_io.is_link(p):
                            self.stats["skipped_symlinks"] += 1; continue
                        s = p.stat()
                        if not stat.S_ISREG(s.st_mode):
                            continue
                        self.stats["examined_members"] += 1
                        if s.st_size not in sizes:
                            continue
                        sig = signature(p)
                        c = self._hash(p, sig, -1, None, s.st_size, lambda p=p: regular(p))
                        if wanted.get(c.sha256) == c.bytes:
                            found.setdefault(c.sha256, c)
                    if len(found) == len(wanted):
                        break
            else:
                sig = signature(root)
                with regular(root) as stream, zipfile.ZipFile(stream) as archive:
                    for ordinal, item in enumerate(archive.infolist()):
                        self.stats["examined_members"] += 1
                        if item.is_dir() or item.file_size not in sizes:
                            continue
                        mode = item.external_attr >> 16
                        if stat.S_ISLNK(mode):
                            self.stats["skipped_symlinks"] += 1; continue
                        c = self._hash(root, sig, ordinal, item.filename, item.file_size,
                                       lambda item=item: archive.open(item))
                        if wanted.get(c.sha256) == c.bytes:
                            found.setdefault(c.sha256, c)
                        if len(found) == len(wanted):
                            break
            if len(found) == len(wanted):
                break
        return found


def plan(request: dict[str, Any], identity: str, roots: list[Path], index: Path) -> dict[str, Any]:
    started = time.monotonic()
    cache = SourceIndex(index)
    try:
        found = cache.scan(roots, request["objects"])
        missing = [x for x in request["objects"] if x["sha256"] not in found]
        return {"schema": "commons.original-source-object-plan/v1", "request_sha256": identity,
                "operation": request.get("operation"), "complete": not missing,
                "objects_count": len(request["objects"]),
                "unique_bytes": request["unique_bytes"],
                "matched_objects": len(found), "missing": missing,
                "sources": {k: dataclasses.asdict(v) for k, v in found.items()},
                "scan": cache.stats, "elapsed_seconds": time.monotonic() - started}
    finally:
        cache.close()


def export(request: dict[str, Any], request_hash: str, selection: dict[str, Any],
           destination: Path, compress: bool = False) -> dict[str, Any]:
    if selection.get("request_sha256") != request_hash or not selection.get("complete"):
        raise TransferError("Export requires this request's complete source plan")
    destination = object_io.native(destination)
    if destination.exists() or object_io.is_link(destination):
        raise TransferError("Use a new packet destination: " + str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".objects-", delete=False) as raw:
            pending = Path(raw.name)
            stream = gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) if compress else raw
            try:
                header = {"schema": PACKET, "operation": request.get("operation"),
                          "request_sha256": request_hash, "objects_count": request["objects_count"],
                          "unique_bytes": request["unique_bytes"]}
                if "source_manifest_sha256" in request:
                    header["source_manifest_sha256"] = request["source_manifest_sha256"]
                stream.write(canonical(header).rstrip()[:-1] + b',"objects":[')
                with contextlib.ExitStack() as sources:
                    archives: dict[str, zipfile.ZipFile] = {}
                    for ordinal, row in enumerate(request["objects"]):
                        if ordinal:
                            stream.write(b",")
                        stream.write(canonical(row).rstrip()[:-1] + b',"content_base64":"')
                        source = Candidate(**selection["sources"][row["sha256"]])
                        size, h, carry = 0, hashlib.sha256(), b""
                        with source.open(sources, archives) as src:
                            while block := src.read(BLOCK):
                                h.update(block); size += len(block)
                                chunk = carry + block; boundary = len(chunk) // 3 * 3
                                stream.write(base64.b64encode(chunk[:boundary])); carry = chunk[boundary:]
                            if carry:
                                stream.write(base64.b64encode(carry))
                        if size != row["bytes"] or h.hexdigest() != row["sha256"]:
                            raise TransferError("Original object changed before export: " + row["sha256"])
                        stream.write(b'"}')
                stream.write(b"]}\n")
                if compress:
                    stream.close()
                raw.flush(); os.fsync(raw.fileno())
            finally:
                if compress and not stream.closed:
                    stream.close()
        # The complete, flushed writer is now closed. Never replace a packet.
        object_io.publish_file(pending, destination)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    size, identity = hash_file(destination)
    return {"schema": "commons.original-source-object-export/v1", "path": str(destination),
            "bytes": size, "sha256": identity, "compression": "gzip" if compress else "none",
            "request_sha256": request_hash, "objects_count": request["objects_count"],
            "unique_bytes": request["unique_bytes"],
            "logical_paths": sum(len(x["paths"]) for x in request["objects"])}


class JsonStream:
    """Small metadata values plus arbitrarily long unescaped Base64 strings."""
    def __init__(self, stream: BinaryIO, metadata_limit: int = 8 * 1024 * 1024):
        self.stream, self.buffer, self.eof = stream, b"", False
        self.decoder = json.JSONDecoder(object_pairs_hook=pairs)
        self.metadata_limit = metadata_limit

    def fill(self) -> bool:
        chunk = self.stream.read(BLOCK)
        if not chunk:
            self.eof = True; return False
        self.buffer += chunk
        return True

    def whitespace(self) -> None:
        while True:
            self.buffer = self.buffer.lstrip(b" \t\r\n")
            if self.buffer or self.eof:
                return
            self.fill()

    def peek(self) -> bytes:
        self.whitespace()
        return self.buffer[:1]

    def expect(self, literal: bytes) -> None:
        self.whitespace()
        if not self.buffer.startswith(literal):
            raise TransferError("Unexpected packet JSON token; expected " + repr(literal))
        self.buffer = self.buffer[len(literal):]

    def value(self) -> Any:
        self.whitespace()
        while True:
            if len(self.buffer) > self.metadata_limit:
                raise TransferError("Packet metadata value exceeds the configured limit")
            try:
                text = self.buffer.decode("utf-8")
                value, end = self.decoder.raw_decode(text)
                # Wait for a delimiter when a numeric token could continue.
                if end == len(text) and not self.eof:
                    self.fill(); continue
                self.buffer = self.buffer[len(text[:end].encode('utf-8')):]
                return value
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                if self.eof:
                    raise TransferError("Incomplete or invalid packet JSON") from exc
                self.fill()

    def decoded_body(self, path: Path) -> tuple[int, str]:
        self.expect(b'"')
        h, size, carry, padded = hashlib.sha256(), 0, b"", False
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(object_io.open_file(object_io.native(path), flags), "r+b") as out:
            original = os.fstat(out.fileno())
            if not stat.S_ISREG(original.st_mode) or original.st_nlink != 1:
                raise TransferError("Receiving stage is not an independent regular file")
            remaining = original.st_size
            while True:
                if not self.buffer and not self.fill():
                    raise TransferError("Truncated Base64 object")
                quote = self.buffer.find(b'"')
                terminal = quote >= 0
                chunk = self.buffer[:quote] if terminal else self.buffer
                self.buffer = self.buffer[quote + 1:] if terminal else b""
                if padded and chunk:
                    raise TransferError("Base64 data follows padding")
                carry += chunk
                amount = len(carry) if terminal else max(0, (len(carry) // 4 - 1) * 4)
                encoded, carry = carry[:amount], carry[amount:]
                if encoded:
                    if not BASE64.fullmatch(encoded) or len(encoded) % 4:
                        raise TransferError("Object body is not canonical Base64")
                    try:
                        decoded = base64.b64decode(encoded, validate=True)
                    except ValueError as exc:
                        raise TransferError("Invalid Base64 object body") from exc
                    if base64.b64encode(decoded) != encoded:
                        raise TransferError("Noncanonical Base64 object body")
                    padded = b"=" in encoded
                    prefix = min(remaining, len(decoded))
                    if prefix and out.read(prefix) != decoded[:prefix]:
                        raise TransferError("Interrupted decoded object differs; preserved " + str(path))
                    remaining -= prefix
                    out.write(decoded[prefix:]); h.update(decoded); size += len(decoded)
                if terminal:
                    if carry:
                        raise TransferError("Truncated Base64 quartet")
                    if remaining:
                        raise TransferError("Interrupted decoded object has extra bytes: " + str(path))
                    break
            out.flush(); os.fsync(out.fileno())
        return size, h.hexdigest()

    def mapping(self, object_directory: Path | None = None, ordinal: int = 0) -> dict[str, Any]:
        self.expect(b"{"); result = {}; body = None
        if self.peek() != b"}":
            while True:
                key = self.value()
                if not isinstance(key, str) or key in result:
                    raise TransferError("Invalid or duplicate packet property")
                self.expect(b":")
                if key == "content_base64" and object_directory is not None:
                    body = object_directory / ("body-" + str(ordinal).zfill(8))
                    size, identity = self.decoded_body(body)
                    result[key] = {"path": str(body), "bytes": size, "sha256": identity}
                else:
                    result[key] = self.value()
                if self.peek() == b"}":
                    break
                self.expect(b",")
                if self.peek() == b"}":
                    raise TransferError("Trailing comma in packet object")
        self.expect(b"}")
        return result


def read_packet(path: Path, stage: Path, expected: str | None = None) -> dict[str, Any]:
    physical_bytes, physical_hash = hash_file(path)
    if expected and physical_hash != valid_hash(expected):
        raise TransferError("Packet does not match its declared physical SHA-256")
    with regular(path) as raw:
        magic = raw.read(2); raw.seek(0)
        with contextlib.ExitStack() as stack:
            stream = stack.enter_context(gzip.GzipFile(fileobj=raw)) if magic == b"\x1f\x8b" else raw
            reader = JsonStream(stream); reader.expect(b"{"); meta, rows, seen = {}, [], set()
            while reader.peek() != b"}":
                key = reader.value()
                if not isinstance(key, str) or key in seen:
                    raise TransferError("Invalid or repeated packet property")
                seen.add(key); reader.expect(b":")
                if key != "objects":
                    meta[key] = reader.value()
                else:
                    reader.expect(b"[")
                    while reader.peek() != b"]":
                        row = reader.mapping(stage, len(rows))
                        actual = row.pop("content_base64", None)
                        if not isinstance(actual, dict):
                            raise TransferError("Every packet object needs content_base64")
                        if actual["bytes"] != row.get("bytes") or actual["sha256"] != row.get("sha256"):
                            raise TransferError("Packet object bytes differ from their identity")
                        row["staged"] = actual["path"]; rows.append(row)
                        if reader.peek() == b"]": break
                        reader.expect(b",")
                        if reader.peek() == b"]":
                            raise TransferError("Trailing comma in packet object array")
                    reader.expect(b"]")
                if reader.peek() == b"}": break
                reader.expect(b",")
                if reader.peek() == b"}":
                    raise TransferError("Trailing comma in packet")
            reader.expect(b"}")
            if reader.peek():
                raise TransferError("Trailing bytes after packet JSON")
    clean = validate_objects(rows)
    if meta.get("schema") != PACKET or "objects" not in seen:
        raise TransferError("Use " + PACKET)
    if natural(meta.get("objects_count", len(rows)), "objects_count") != len(rows):
        raise TransferError("Packet object count differs")
    if natural(meta.get("unique_bytes", sum(x["bytes"] for x in rows)), "unique_bytes") != sum(x["bytes"] for x in rows):
        raise TransferError("Packet source byte total differs")
    return {**meta, "objects": [{**row, "staged": original["staged"]}
                                 for row, original in zip(clean, rows)],
            "packet_bytes": physical_bytes, "packet_sha256": physical_hash}


@contextlib.contextmanager
def parent_fd(root, name: str, create: bool = False) -> Iterator[tuple[Any, str]]:
    """Hold each parent by its native directory handle, never follow target links."""
    with object_io.parent(root, relative(name), create) as value:
        yield value


def target_state(root, name: str, expected: tuple[int, str]) -> str:
    try:
        with parent_fd(root, name) as (directory, leaf):
            fd = directory.open(leaf, os.O_RDONLY)
            with os.fdopen(fd, "rb") as f:
                if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
                    return "conflict"
                return "identical" if hash_stream(f) == expected else "conflict"
    except FileNotFoundError:
        return "missing"
    except (NotADirectoryError, OSError):
        return "conflict"


@contextlib.contextmanager
def receiving_stage(destination: Path, packet_hash: str, packet_bytes: int) -> Iterator[Path]:
    """Own a deterministic decode stage, surviving process death without a copy farm."""
    key = sha((str(destination) + "\0" + packet_hash).encode("utf-8"))
    stage = destination.parent / (".source-objects-" + key)
    if object_io.is_link(stage):
        raise TransferError("Receiving stage must not be a symlink or reparse point")
    stage.mkdir(mode=0o700, exist_ok=True)
    owner = {"schema": "commons.original-source-object-stage/v1", "destination": str(destination),
             "packet_sha256": packet_hash, "packet_bytes": packet_bytes}
    identity_file = stage / "STAGE.json"
    expected = canonical(owner)
    if identity_file.exists() or object_io.is_link(identity_file):
        with regular(identity_file) as f:
            if f.read() != expected:
                raise TransferError("Existing receiving stage has another owner; preserved " + str(stage))
    else:
        if any(stage.iterdir()):
            raise TransferError("Unidentified nonempty receiving stage preserved: " + str(stage))
        with identity_file.open("xb") as f:
            f.write(expected); f.flush(); os.fsync(f.fileno())
    # Keep the directory itself anchored on Windows throughout decode.
    # An exception or process kill retains exact partial bytes for this packet.
    with object_io.open_directory(stage):
        yield stage
    # Completion removes only this operation's own decoded cache, not originals.
    with regular(identity_file) as f:
        if f.read() != expected:
            raise TransferError("Receiving stage ownership changed; preserved " + str(stage))
    shutil.rmtree(stage)


def _receive(packet: Path, destination: Path, expected: str | None = None,
            request: tuple[dict[str, Any], str] | None = None, dry_run: bool = False,
            *, root=None) -> dict[str, Any]:
    destination = object_io.native(destination)
    if object_io.is_link(destination):
        raise TransferError("Receiving root must not be a symlink or reparse point")
    if not destination.exists():
        if dry_run:
            raise TransferError("Create the owned destination before a read-only receiving plan")
        destination.mkdir(parents=True, exist_ok=False)
    destination = destination.resolve(strict=True)
    root = root if root is not None else destination
    # Decode to a separate same-filesystem scratch tree. A corrupt later object
    # cannot make an earlier unvalidated object appear in the receiving tree.
    physical_size, physical_hash = hash_file(packet)
    if expected and physical_hash != valid_hash(expected):
        raise TransferError("Packet does not match its declared physical SHA-256")
    with receiving_stage(destination, physical_hash, physical_size) as stage:
        decoded = read_packet(packet, stage, physical_hash)
        if request is not None:
            doc, request_hash = request
            if decoded.get("request_sha256") != request_hash:
                raise TransferError("Packet is not bound to the supplied original request")
            if decoded.get("source_manifest_sha256") != doc.get("source_manifest_sha256"):
                raise TransferError("Packet names a different original source manifest")
            expected_rows = {x["sha256"]: x for x in doc["objects"]}
            actual_rows = {x["sha256"]: {k:x[k] for k in ("sha256","bytes","paths")} for x in decoded["objects"]}
            if expected_rows != actual_rows:
                raise TransferError("Packet does not contain the complete exact requested selection")
        rows = [(name, row) for row in decoded["objects"] for name in row["paths"]]
        try:
            object_io.validate_names([name for name, _ in rows])
        except object_io.PathConflict as error:
            raise TransferError(str(error)) from error
        states = {name: target_state(root, name, (row["bytes"], row["sha256"]))
                  for name, row in rows}
        conflicts = [name for name, state in states.items() if state == "conflict"]
        if conflicts:
            raise TransferError("Existing original or local edit preserved; conflicting paths: " + ", ".join(conflicts))
        written = 0
        if not dry_run:
            for name, row in rows:
                if states[name] == "identical":
                    pending_id = sha((decoded["packet_sha256"] + "\0" + name).encode("utf-8"))
                    pending_name = str(PurePosixPath(name).parent / (".original-object-" + pending_id))
                    if target_state(root, pending_name, (row["bytes"], row["sha256"])) == "identical":
                        with parent_fd(root, pending_name) as (directory, leaf):
                            directory.unlink(leaf); directory.sync()
                    continue
                with parent_fd(root, name, create=True) as (directory, leaf):
                    # Each logical path gets its own inode so editing one companion
                    # never alters another equal-content logical source path.
                    pending_id = sha((decoded["packet_sha256"] + "\0" + name).encode("utf-8"))
                    temporary_leaf = ".original-object-" + pending_id
                    fd = directory.open(temporary_leaf, os.O_RDWR | os.O_CREAT)
                    with os.fdopen(fd, "r+b") as out, regular(Path(row["staged"])) as source:
                        pending_stat = os.fstat(out.fileno())
                        if (not stat.S_ISREG(pending_stat.st_mode) or pending_stat.st_nlink != 1
                                or pending_stat.st_size > row["bytes"]):
                            raise TransferError("Interrupted receiving file differs; preserved " + name)
                        remaining = pending_stat.st_size
                        while remaining:
                            amount = min(BLOCK, remaining)
                            if out.read(amount) != source.read(amount):
                                raise TransferError("Interrupted receiving edit preserved: " + name)
                            remaining -= amount
                        while block := source.read(BLOCK): out.write(block)
                        out.flush(); os.fsync(out.fileno()); out.seek(0)
                        if hash_stream(out) != (row["bytes"], row["sha256"]):
                            raise TransferError("Staged source changed before publication: " + name)
                    try:
                        directory.publish(temporary_leaf, leaf)
                        written += 1
                    except FileExistsError:
                        if target_state(root, name, (row["bytes"], row["sha256"])) != "identical":
                            raise TransferError("Concurrent local edit preserved: " + name)
                    directory.unlink(temporary_leaf, missing_ok=True)
                    directory.sync()
            # A fresh read verifies every logical alias, including unchanged ones.
            for name, row in rows:
                if target_state(root, name, (row["bytes"], row["sha256"])) != "identical":
                    raise TransferError("Received source changed during final readback: " + name)
        return {"schema": "commons.original-source-object-receiving/v1",
                "operation": decoded.get("operation"), "version": VERSION,
                "packet_sha256": decoded["packet_sha256"], "packet_bytes": decoded["packet_bytes"],
                "request_sha256": decoded.get("request_sha256"), "destination": str(destination),
                "dry_run": dry_run, "objects_count": len(decoded["objects"]),
                "unique_bytes": sum(x["bytes"] for x in decoded["objects"]),
                "logical_paths": len(rows), "new_paths": written,
                "reused_paths": sum(x == "identical" for x in states.values()),
                "missing_paths": sum(x == "missing" for x in states.values()) if dry_run else 0}


def receive(packet: Path, destination: Path, expected: str | None = None,
            request: tuple[dict[str, Any], str] | None = None, dry_run: bool = False) -> dict[str, Any]:
    """Serialize only this native receiving root; preserve Workspace/run locks."""
    try:
        with object_io.receiving_root(destination, dry_run) as root:
            return _receive(packet, root.path, expected, request, dry_run, root=root)
    except object_io.PathConflict as error:
        raise TransferError(str(error)) from error


def request_archive(archive_path: Path, prefixes: list[str], strip_prefix: str = "",
                    expected: str | None = None) -> dict[str, Any]:
    size, identity = hash_file(archive_path)
    if expected and identity != valid_hash(expected):
        raise TransferError("Archive bytes differ from the supplied identity")
    if strip_prefix and not strip_prefix.endswith("/"):
        strip_prefix += "/"
    groups: dict[str, dict[str, Any]] = {}
    with regular(archive_path) as f, zipfile.ZipFile(f) as archive:
        catalog = json.loads(archive.read("ARCHIVE.json"), object_pairs_hook=pairs)
        members = catalog.get("members")
        if isinstance(members, dict):
            members = [{**metadata, "path": name} for name, metadata in members.items()]
        elif not isinstance(members, list):
            raise TransferError("Expected the original portable archive's members inventory")
        # Read the exact maintained archive manifest, not inferred or regenerated source.
        for item in members:
            name = item.get("path")
            if not isinstance(name, str) or not any(name.startswith(p) for p in prefixes): continue
            if strip_prefix and not name.startswith(strip_prefix):
                raise TransferError("Selected member is outside the explicitly stripped prefix")
            destination = name[len(strip_prefix):] if strip_prefix else name
            member_hash = valid_hash(item.get("sha256")); member_bytes = natural(item.get("bytes"), "member bytes")
            row = groups.setdefault(member_hash, {"sha256": member_hash, "bytes": member_bytes, "paths": []})
            if row["bytes"] != member_bytes: raise TransferError("Archive repeats an inconsistent object")
            row["paths"].append(relative(destination))
    rows = validate_objects(list(groups.values()))
    if not rows: raise TransferError("No original members matched the supplied archive prefixes")
    return {"schema": REQUEST, "operation": "retained-archive-selection-" + identity[:16],
            "original_archive": {"name": archive_path.name, "bytes": size, "sha256": identity},
            "selected_prefixes": prefixes, "strip_prefix": strip_prefix,
            "objects_count": len(rows), "unique_bytes": sum(x["bytes"] for x in rows), "objects": rows}


def request_inventory(path: Path, expected: str | None = None) -> dict[str, Any]:
    """Keep exact editions from an existing metadata-only source inventory."""
    with regular(path) as f:
        body = f.read()
    identity = sha(body)
    if expected and identity != valid_hash(expected):
        raise TransferError("Source inventory differs from its supplied SHA-256")
    doc = json.loads(body, object_pairs_hook=pairs)
    if not isinstance(doc, dict) or doc.get("schema") != "commons.source-inventory/v1":
        raise TransferError("Use commons.source-inventory/v1")
    files = doc.get("files")
    if not isinstance(files, list) or not files:
        raise TransferError("Source inventory must contain original files")
    if natural(doc.get("file_count"), "file_count") != len(files):
        raise TransferError("Source inventory file count differs")
    groups: dict[str, dict[str, Any]] = {}
    total = 0
    for item in files:
        if not isinstance(item, dict):
            raise TransferError("Each source inventory entry must be an object")
        name = relative(item.get("path"))
        item_hash = valid_hash(item.get("sha256"))
        item_bytes = natural(item.get("bytes"), "source bytes")
        total += item_bytes
        row = groups.setdefault(item_hash, {"sha256": item_hash, "bytes": item_bytes, "paths": []})
        if row["bytes"] != item_bytes:
            raise TransferError("Source inventory repeats an inconsistent object")
        row["paths"].append(name)
    if natural(doc.get("source_bytes"), "source_bytes") != total:
        raise TransferError("Source inventory byte total differs")
    rows = validate_objects(list(groups.values()))
    return {"schema": REQUEST, "operation": "source-inventory-selection-" + identity[:16],
            "source_inventory": {"name": path.name, "bytes": len(body), "sha256": identity,
                "edition": doc.get("edition"), "repository": doc.get("repository"),
                "source_commit": doc.get("source_commit"), "source_path": doc.get("source_path"),
                "application_prefix": doc.get("application_prefix")},
            "source_manifest_sha256": identity,
            "objects_count": len(rows), "unique_bytes": sum(x["bytes"] for x in rows), "objects": rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    arc = commands.add_parser("request-archive", help="Select original ARCHIVE.json members by explicit prefix")
    arc.add_argument("--archive", type=Path, required=True); arc.add_argument("--archive-sha256")
    arc.add_argument("--prefix", action="append", required=True); arc.add_argument("--strip-prefix", default="")
    arc.add_argument("--output", type=Path, required=True)
    inv = commands.add_parser("request-inventory", help="Use exact metadata-only source inventory editions")
    inv.add_argument("--inventory", type=Path, required=True); inv.add_argument("--inventory-sha256")
    inv.add_argument("--output", type=Path, required=True)
    for command in ("plan", "export"):
        sub = commands.add_parser(command)
        sub.add_argument("--request", type=Path, required=True); sub.add_argument("--request-sha256")
        sub.add_argument("--source", type=Path, action="append", required=True)
        sub.add_argument("--index", type=Path, required=True)
        sub.add_argument("--report", type=Path, required=True)
        if command == "export":
            sub.add_argument("--output", type=Path, required=True)
            sub.add_argument("--gzip", action="store_true")
    rec = commands.add_parser("receive")
    rec.add_argument("--packet", type=Path, required=True); rec.add_argument("--packet-sha256")
    rec.add_argument("--destination", type=Path, required=True); rec.add_argument("--report", type=Path, required=True)
    rec.add_argument("--request", type=Path); rec.add_argument("--request-sha256")
    rec.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command in ("request-archive", "request-inventory"):
            result = (request_archive(args.archive, args.prefix, args.strip_prefix, args.archive_sha256)
                      if args.command == "request-archive" else
                      request_inventory(args.inventory, args.inventory_sha256))
            write_json(args.output, result)
            print(json.dumps({"path": str(args.output), "sha256": hash_file(args.output)[1],
                              "objects_count": result["objects_count"], "unique_bytes": result["unique_bytes"]}))
            return 0
        if args.command in ("plan", "export"):
            doc, identity = read_request(args.request, args.request_sha256)
            result = plan(doc, identity, args.source, args.index)
            write_json(args.report, result)
            print(json.dumps({k: v for k, v in result.items() if k not in ("sources", "missing")}))
            if not result["complete"]:
                print("Exact missing source objects retained in " + str(args.report), file=sys.stderr)
                return 2
            if args.command == "export":
                result = export(doc, identity, result, args.output, args.gzip)
                write_json(args.report, result); print(json.dumps(result))
            return 0
        if args.request_sha256 and not args.request:
            raise TransferError("--request-sha256 requires --request")
        request = read_request(args.request, args.request_sha256) if args.request else None
        result = receive(args.packet, args.destination, args.packet_sha256, request, args.dry_run)
        write_json(args.report, result); print(json.dumps(result)); return 0
    except (TransferError, object_io.PathConflict, OSError, json.JSONDecodeError, zipfile.BadZipFile, EOFError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
