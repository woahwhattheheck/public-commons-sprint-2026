"""Selective receiving of byte-split, ordinary ZIP archives. Python 3.10+.

The original ecosystem archive-parts manifest is the source of identities.
The ZIP is exposed as a seekable, verified view, never a zero-filled sparse file.
Only selected, complete members are extracted; scientific/Workspace code is not run.
Copyright 2026 TokenJunkieLabs. MIT License.
"""
from __future__ import annotations

import argparse
import bisect
import contextlib
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import struct
import sys
import tempfile
import time
import unicodedata
import zipfile
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, BinaryIO, Iterable

VERSION = "1.0.0"
CHUNK = 1024 * 1024
STATE = ".parted-zip"
SHA = re.compile(r"[0-9a-f]{64}\Z")
RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?\Z", re.I)


class ArchiveError(Exception):
    """A reported operation failure; no provider or transport retry is hidden."""


class NeedParts(ArchiveError):
    def __init__(self, parts: list[dict[str, Any]], phase: str = "read"):
        self.parts, self.phase = parts, phase
        super().__init__("Receive original archive parts: " + ", ".join(str(p["part"]) for p in parts))


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ArchiveError(f"Duplicate JSON key: {key!r}")
        result[key] = value
    return result


def read_json(path: Path) -> tuple[bytes, Any]:
    raw = path.read_bytes()
    try:
        return raw, json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_pairs)
    except (UnicodeError, ValueError) as exc:
        raise ArchiveError(f"Invalid UTF-8 JSON in {path.name}: {exc}") from exc


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def integer(value: Any, label: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ArchiveError(f"{label} must be an integer >= {minimum}")
    return value


def sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ArchiveError(f"{label} must be a lowercase SHA-256 digest")
    return value


def safe_name(name: Any, *, directory: bool = False) -> str:
    """Reject, rather than rewrite, names that are unsafe or not portable."""
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ArchiveError(f"Unsafe archive path: {name!r}")
    cleaned = name[:-1] if directory and name.endswith("/") else name
    components = cleaned.split("/")
    if not cleaned or any(c in ("", ".", "..") for c in components):
        raise ArchiveError(f"Non-canonical archive path: {name!r}")
    if any(any(ord(x) < 32 or ord(x) == 127 for x in c) or c.endswith((".", " ")) or RESERVED.fullmatch(c) for c in components):
        raise ArchiveError(f"Non-portable archive path: {name!r}")
    return cleaned


def basename(name: Any) -> str:
    name = safe_name(name)
    if "/" in name:
        raise ArchiveError("A part filename must be a basename, not a path")
    return name


def file_signature(handle: BinaryIO) -> tuple[int, ...]:
    s = os.fstat(handle.fileno())
    if not stat.S_ISREG(s.st_mode):
        raise ArchiveError("A part or output is not a regular file")
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def open_regular(path: Path) -> BinaryIO:
    # lstat also covers platforms where O_NOFOLLOW is unavailable.
    if path.is_symlink():
        raise ArchiveError(f"Refusing symbolic link: {path}")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    f = os.fdopen(os.open(path, flags), "rb")
    try:
        file_signature(f)
    except BaseException:
        f.close()
        raise
    return f


def hash_file(path: Path) -> tuple[str, int]:
    h, count = hashlib.sha256(), 0
    with open_regular(path) as f:
        before = file_signature(f)
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
            count += len(block)
        if file_signature(f) != before:
            raise ArchiveError(f"File changed while reading: {path.name}")
    return h.hexdigest(), count


@dataclass(frozen=True)
class Part:
    number: int
    filename: str
    size: int
    sha: str
    start: int
    original: dict[str, Any]

    @property
    def end(self) -> int:
        return self.start + self.size

    def description(self) -> dict[str, Any]:
        result = {"part": self.number, "filename": self.filename, "bytes": self.size,
                  "sha256": self.sha, "start": self.start, "end": self.end}
        # Transport descriptors never echo upload URLs, credentials or arbitrary
        # provider fields. The exact complete input stays in manifest.original.json.
        for key in ("file_id", "library_file_id"):
            value = self.original.get(key)
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]+", value):
                result[key] = value
        version = self.original.get("current_version_number")
        if type(version) is int and version >= 0:
            result["current_version_number"] = version
        return result


class Manifest:
    def __init__(self, path: Path, expected_sha: str | None = None):
        self.path = path.resolve()
        self.raw, self.document = read_json(path)
        self.sha = digest(self.raw)
        if expected_sha and self.sha != sha256(expected_sha, "Expected manifest SHA"):
            raise ArchiveError("The original parts manifest differs from the expected SHA-256")
        m = self.document
        if not isinstance(m, dict) or m.get("schema") != "ecosystems.archive-parts/v1":
            raise ArchiveError("Expected original ecosystems.archive-parts/v1 manifest")
        a = m.get("archive")
        if not isinstance(a, dict):
            raise ArchiveError("Missing archive identity")
        self.name = basename(a.get("filename"))
        self.size = integer(a.get("bytes"), "Archive bytes", 22)
        self.archive_sha = sha256(a.get("sha256"), "Archive SHA")
        originals = m.get("parts")
        if not isinstance(originals, list) or not originals:
            raise ArchiveError("Manifest has no ordered parts")
        offset, names, parts = 0, set(), []
        for number, p in enumerate(originals, 1):
            if not isinstance(p, dict):
                raise ArchiveError("Invalid part entry")
            if p.get("part", number) != number or type(p.get("part", number)) is not int:
                raise ArchiveError("Parts must appear in exact contiguous 1-based order")
            name = basename(p.get("filename"))
            key = unicodedata.normalize("NFC", name).casefold()
            if key in names:
                raise ArchiveError("Duplicate or case-colliding part filename")
            names.add(key)
            size = integer(p.get("bytes"), "Part bytes", 1)
            if "offset" in p and integer(p["offset"], "Part offset") != offset:
                raise ArchiveError("Non-contiguous part offset")
            parts.append(Part(number, name, size, sha256(p.get("sha256"), "Part SHA"), offset, p))
            offset += size
        if offset != self.size:
            raise ArchiveError("Part sizes do not sum to the original archive size")
        self.parts, self.starts = parts, [p.start for p in parts]

    def covering(self, start: int, end: int) -> list[Part]:
        if not 0 <= start <= end <= self.size:
            raise ArchiveError("Archive byte range is out of bounds")
        if start == end:
            return []
        left = bisect.bisect_right(self.starts, start) - 1
        right = bisect.bisect_left(self.starts, end)
        return self.parts[left:right]

    def bootstrap(self) -> list[Part]:
        # EOCD + maximum comment + fixed ZIP64 locator/record allowance.
        return self.covering(max(0, self.size - 65558 - 76), self.size)

    def identity(self) -> dict[str, Any]:
        return {"filename": self.name, "bytes": self.size, "sha256": self.archive_sha,
                "parts_manifest_sha256": self.sha}


class PartsIO(io.RawIOBase):
    """Seekable view of original pieces; absent bytes raise NeedParts, never EOF/zeros.

    At most four part handles are retained. Original bytes are fully hashed before
    first use; reopened unchanged inode/size/mtime/ctime snapshots reuse that hash.
    A changed snapshot is rehashed, and changes during an open read are rejected.
    """
    def __init__(self, manifest: Manifest, directory: Path):
        super().__init__()
        self.manifest, self.directory = manifest, directory.resolve()
        self.position = 0
        self.handles: OrderedDict[int, tuple[BinaryIO, tuple[int, ...]]] = OrderedDict()
        self.verified: set[int] = set()
        self.verified_signatures: dict[int, tuple[int, ...]] = {}
        self.touched: set[int] = set()
        self.bytes_served = self.bytes_hashed = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        self._checkClosed()
        return self.position

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        self._checkClosed()
        bases = {os.SEEK_SET: 0, os.SEEK_CUR: self.position, os.SEEK_END: self.manifest.size}
        if whence not in bases or not isinstance(offset, int):
            raise ValueError("Invalid seek")
        position = bases[whence] + offset
        if position < 0:
            raise OSError(errno.EINVAL, "Negative seek")
        self.position = position
        return position

    def _handle(self, part: Part) -> BinaryIO:
        if part.number in self.handles:
            f, signature = self.handles.pop(part.number)
            self.handles[part.number] = f, signature
            if file_signature(f) != signature:
                raise ArchiveError(f"Original part changed during use: {part.filename}")
            return f
        path = self.directory / part.filename
        try:
            f = open_regular(path)
        except FileNotFoundError:
            raise NeedParts([part.description()]) from None
        try:
            signature = file_signature(f)
            if signature[2] != part.size:
                raise ArchiveError(f"Wrong byte count for {part.filename}: {signature[2]}, expected {part.size}")
            if self.verified_signatures.get(part.number) != signature:
                h = hashlib.sha256()
                for block in iter(lambda: f.read(CHUNK), b""):
                    h.update(block)
                    self.bytes_hashed += len(block)
                if h.hexdigest() != part.sha or file_signature(f) != signature:
                    raise ArchiveError(f"Original part SHA-256 verification failed: {part.filename}")
                self.verified_signatures[part.number] = signature
            f.seek(0)
        except BaseException:
            f.close()
            raise
        self.verified.add(part.number)
        self.handles[part.number] = f, signature
        while len(self.handles) > 4:
            _, (old, _) = self.handles.popitem(last=False)
            old.close()
        return f

    def read(self, size: int = -1) -> bytes:
        self._checkClosed()
        if size is None:
            size = -1
        end = self.manifest.size if size < 0 else min(self.manifest.size, self.position + size)
        if self.position >= end:
            return b""
        parts = self.manifest.covering(self.position, end)
        absent = [p.description() for p in parts if not (self.directory / p.filename).exists()]
        if absent:
            raise NeedParts(absent)
        output = bytearray()
        for part in parts:
            f = self._handle(part)
            self.touched.add(part.number)
            offset = self.position - part.start
            length = min(end, part.end) - self.position
            f.seek(offset)
            data = f.read(length)
            if len(data) != length or file_signature(f) != self.handles[part.number][1]:
                raise ArchiveError(f"Part changed or truncated while reading: {part.filename}")
            output.extend(data)
            self.position += length
            self.bytes_served += length
        return bytes(output)

    def readinto(self, buffer: Any) -> int:
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def close(self) -> None:
        for f, _ in self.handles.values():
            f.close()
        self.handles.clear()
        super().close()

    def stats(self) -> dict[str, Any]:
        return {"parts_verified": sorted(self.verified), "parts_read": sorted(self.touched),
                "verified_distinct_part_bytes": sum(self.manifest.parts[i-1].size for i in self.verified),
                "bytes_hashed_including_reopens": self.bytes_hashed, "archive_bytes_served": self.bytes_served}


def check_single_disk(reader: PartsIO) -> None:
    reader.seek(max(0, reader.manifest.size - 65558))
    tail = reader.read()
    cursor = len(tail)
    while True:
        i = tail.rfind(b"PK\x05\x06", 0, cursor)
        if i < 0:
            raise ArchiveError("No complete ZIP end record; ordinary byte-split ZIP required")
        if i + 22 <= len(tail):
            fields = struct.unpack_from("<4s4H2LH", tail, i)
            if i + 22 + fields[-1] == len(tail):
                if fields[1] or fields[2] or fields[3] != fields[4]:
                    raise ArchiveError("True multi-volume ZIP is not supported; these parts must be byte slices of one ZIP")
                return
        cursor = i


def member_row(number: int, info: zipfile.ZipInfo, end: int) -> dict[str, Any]:
    kind = "directory" if info.is_dir() else "file"
    mode = info.external_attr >> 16
    file_type = stat.S_IFMT(mode)
    problem = None
    try:
        safe_name(info.orig_filename, directory=info.is_dir())
        if info.orig_filename != info.filename:
            raise ArchiveError("ZIP member name was truncated or normalized")
        if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ArchiveError("Symbolic links and special files are not extracted")
        if info.volume != 0:
            raise ArchiveError("Member belongs to another ZIP volume")
        if info.flag_bits & 1:
            raise ArchiveError("Encrypted members are not extracted")
    except ArchiveError as exc:
        problem = str(exc)
    return {"ordinal": number, "path": info.orig_filename, "kind": kind,
            "bytes": info.file_size, "compressed_bytes": info.compress_size,
            "crc32": f"{info.CRC:08x}", "compression": info.compress_type,
            "header_offset": info.header_offset, "record_end": end,
            "mode": mode, "flags": info.flag_bits, "date_time": list(info.date_time),
            "extraction_error": problem}


@contextlib.contextmanager
def archive_session(manifest: Manifest, directory: Path):
    with PartsIO(manifest, directory) as reader:
        check_single_disk(reader)
        with zipfile.ZipFile(reader, "r") as archive:
            infos = archive.infolist()
            central_start = archive.start_dir  # CPython's adjusted physical central-directory offset.
            offsets = sorted(set(i.header_offset for i in infos))
            next_offsets = dict(zip(offsets, offsets[1:] + [central_start]))
            rows = []
            for number, info in enumerate(infos):
                start, end = info.header_offset, next_offsets[info.header_offset]
                if start < 0 or start + 30 > end or end > central_start or central_start > manifest.size:
                    raise ArchiveError(f"Invalid or overlapping ZIP member record: {info.orig_filename!r}")
                rows.append(member_row(number, info, end))
            metadata_parts = sorted(reader.touched)
            # Include EOCD/ZIP64/comment-search reads as well as central records.
            # A fresh receiver following this plan needs those original parts too.
            index = {"schema": "ecosystems.parted-zip-index/v1", "version": VERSION,
                     "archive": manifest.identity(), "central_directory_start": central_start,
                     "metadata_parts": metadata_parts, "parts": [p.description() for p in manifest.parts],
                     "members": rows}
            yield reader, archive, index


def load_selection(path: Path, index: dict[str, Any]) -> list[int]:
    _, document = read_json(path)
    if not isinstance(document, dict) or document.get("schema") != "ecosystems.parted-zip-selection/v1":
        raise ArchiveError("Expected a saved parted-ZIP selection")
    if document.get("archive") != index["archive"]:
        raise ArchiveError("Saved selection belongs to a different archive or manifest edition")
    selected = document.get("members")
    if not isinstance(selected, list) or not selected:
        raise ArchiveError("Saved selection has no members")
    ordinals = []
    for row in selected:
        if not isinstance(row, dict):
            raise ArchiveError("Invalid saved member")
        ordinal = integer(row.get("ordinal"), "Member ordinal")
        if ordinal >= len(index["members"]):
            raise ArchiveError("Saved member is outside the original central directory")
        actual = index["members"][ordinal]
        if any(row.get(k) != actual[k] for k in ("path", "header_offset", "bytes", "crc32")):
            raise ArchiveError("Saved member identity differs from the original directory")
        ordinals.append(ordinal)
    if len(ordinals) != len(set(ordinals)):
        raise ArchiveError("Saved selection repeats a member ordinal")
    return sorted(ordinals)


def select(index: dict[str, Any], prefixes: Iterable[str] = (), paths: Iterable[str] = (),
           ordinals: Iterable[int] = (), all_members: bool = False) -> list[int]:
    rows = index["members"]
    chosen: set[int] = set(range(len(rows))) if all_members else set()
    for prefix in prefixes:
        prefix = safe_name(prefix, directory=True).rstrip("/") + "/"
        matching = [r["ordinal"] for r in rows if r["path"].startswith(prefix)]
        if not matching:
            raise ArchiveError(f"No original members below prefix {prefix!r}")
        chosen.update(matching)
    for path in paths:
        matching = [r["ordinal"] for r in rows if r["path"] == path]
        if not matching:
            raise ArchiveError(f"No original member named {path!r}")
        if len(matching) > 1:
            raise ArchiveError(f"Duplicate original name {path!r}; select exact --ordinal or an entries-layout prefix")
        chosen.update(matching)
    for ordinal in ordinals:
        integer(ordinal, "Member ordinal")
        if ordinal >= len(rows):
            raise ArchiveError("Member ordinal is outside the original directory")
        chosen.add(ordinal)
    if not chosen:
        raise ArchiveError("Choose an explicit whole prefix, exact member, saved selection or --all")
    return sorted(chosen)


def selection_document(index: dict[str, Any], ordinals: list[int]) -> dict[str, Any]:
    return {"schema": "ecosystems.parted-zip-selection/v1", "archive": index["archive"],
            "members": [{k: index["members"][i][k] for k in ("ordinal", "path", "header_offset", "bytes", "crc32")} for i in ordinals]}


def make_plan(manifest: Manifest, index: dict[str, Any], ordinals: list[int], directory: Path,
              reader: PartsIO | None = None) -> dict[str, Any]:
    needed = set(index["metadata_parts"])
    rows, header_parts, exact_count = [], set(), 0
    for ordinal in ordinals:
        row = index["members"][ordinal]
        start, end, method = row["header_offset"], row["record_end"], "complete-record-span"
        hp = manifest.covering(start, start + 30)
        header_parts.update(p.number for p in hp)
        # An available, verified local header can narrow padded record spans to
        # the exact bytes ZipFile.open needs. Otherwise the full record is safe.
        if reader and all((directory / p.filename).is_file() for p in hp):
            reader.seek(start)
            raw = reader.read(30)
            header = struct.unpack("<4s5H3L2H", raw)
            if header[0] != b"PK\x03\x04":
                raise ArchiveError(f"Invalid original local header for ordinal {ordinal}")
            end = start + 30 + header[-2] + header[-1] + row["compressed_bytes"]
            if end > row["record_end"]:
                raise ArchiveError("Member payload exceeds its original record span")
            method = "local-header-and-compressed-payload"
            exact_count += 1
        covering = manifest.covering(start, end)
        needed.update(p.number for p in covering)
        rows.append({"ordinal": ordinal, "path": row["path"], "start": start, "end": end,
                     "range_basis": method, "parts": [p.number for p in covering]})
    pieces = [manifest.parts[i-1].description() for i in sorted(needed)]
    missing = [p for p in pieces if not (directory / p["filename"]).is_file()]
    return {"schema": "ecosystems.parted-zip-plan/v1", "archive": manifest.identity(),
            "selection": selection_document(index, ordinals),
            "selected_members": len(ordinals), "selected_uncompressed_bytes": sum(index["members"][i]["bytes"] for i in ordinals),
            "required_parts": pieces, "missing_parts": missing,
            "required_part_bytes": sum(p["bytes"] for p in pieces),
            "missing_part_bytes": sum(p["bytes"] for p in missing),
            "saved_transfer_bytes": manifest.size - sum(p["bytes"] for p in pieces),
            "exact_local_header_ranges": exact_count, "member_ranges": rows,
            "missing_header_parts": [manifest.parts[i-1].description() for i in sorted(header_parts) if not (directory / manifest.parts[i-1].filename).is_file()]}


def output_paths(index: dict[str, Any], ordinals: list[int], layout: str) -> dict[int, str]:
    outputs: dict[int, str] = {}
    occupied: dict[str, tuple[str, bool]] = {}
    for i in ordinals:
        row = index["members"][i]
        if row["extraction_error"]:
            raise ArchiveError(f"Cannot extract ordinal {i}: {row['extraction_error']}")
        name = safe_name(row["path"], directory=row["kind"] == "directory")
        if layout == "entries":
            name = f"entries/{i:08d}/{name}"
        if name.split("/")[0].casefold() == STATE:
            raise ArchiveError("Selected member collides with extraction state directory")
        components = name.split("/")
        for j in range(1, len(components) + 1):
            spelling = "/".join(components[:j])
            key = unicodedata.normalize("NFC", spelling).casefold()
            directory = j < len(components) or row["kind"] == "directory"
            if key in occupied:
                old, was_directory = occupied[key]
                if old != spelling or not (directory and was_directory):
                    raise ArchiveError(f"Selected members collide at {spelling!r}; use --layout entries to retain separate entries")
            occupied[key] = spelling, directory
        outputs[i] = name
    return outputs


def ensure_directory(path: Path) -> None:
    if path.is_symlink():
        raise ArchiveError(f"Refusing symbolic-link directory: {path}")
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        if not path.is_dir():
            raise ArchiveError(f"Expected a directory: {path}") from None


def safe_parent(root: Path, relative: str, directory: bool = False) -> Path:
    pieces = safe_name(relative).split("/")
    p = root
    if root.is_symlink() or not root.is_dir():
        raise ArchiveError("Extraction root is no longer a regular directory")
    for piece in pieces if directory else pieces[:-1]:
        p /= piece
        ensure_directory(p)
    result = root.joinpath(*pieces)
    if result.is_symlink():
        raise ArchiveError(f"Refusing symbolic-link target: {relative}")
    return result


def fsync_directory(path: Path) -> None:
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_atomic(path: Path, raw: bytes) -> None:
    """Atomic metadata replacement only; never used to replace original members."""
    if path.is_symlink():
        raise ArchiveError(f"Refusing symbolic-link metadata: {path}")
    fd, temporary = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


@contextlib.contextmanager
def extraction_lock(path: Path):
    if path.is_symlink():
        raise ArchiveError("Refusing symbolic-link operation lock")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    f = os.fdopen(fd, "r+b")
    try:
        if os.name == "posix":
            import fcntl
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ArchiveError("This extraction already has an active writer") from None
        elif os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                f.write(b"0"); f.flush()
            f.seek(0)
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise ArchiveError("This extraction already has an active writer") from None
        else:
            raise ArchiveError("This platform has no supported extraction lock")
        yield
    finally:
        f.close()


def extract(manifest: Manifest, directory: Path, destination: Path,
            index: dict[str, Any], ordinals: list[int], reader: PartsIO,
            archive: zipfile.ZipFile, layout: str = "tree") -> dict[str, Any]:
    started = time.perf_counter()
    mapping = output_paths(index, ordinals, layout)
    plan = make_plan(manifest, index, ordinals, directory, reader)
    if plan["missing_parts"]:
        raise NeedParts(plan["missing_parts"], "selected-members")
    # Verify every required original part before creating a receiving tree.
    for p in plan["required_parts"]:
        reader._handle(manifest.parts[p["part"]-1])
    selection = selection_document(index, ordinals)
    operation = {"schema": "ecosystems.parted-zip-extraction/v1", "archive": manifest.identity(),
                 "selection_sha256": digest(canonical(selection)), "layout": layout}
    destination = destination.absolute()
    if destination.is_symlink():
        raise ArchiveError("Destination must not be a symbolic link")
    destination.parent.mkdir(parents=True, exist_ok=True)
    ensure_directory(destination)
    state = destination / STATE
    if not state.exists() and any(destination.iterdir()):
        raise ArchiveError("Use a new empty output directory; an existing Workspace is never overlaid")
    ensure_directory(state)
    with extraction_lock(state / "writer.lock"):
        operation_path = state / "operation.json"
        if operation_path.exists():
            _, previous = read_json(operation_path)
            if previous != operation:
                raise ArchiveError("Output is bound to another archive, selection or layout")
        else:
            # Safe restart even when a previous process died before operation.json.
            if any(p.name != STATE for p in destination.iterdir()):
                raise ArchiveError("Unbound output already contains files")
            write_atomic(state / "manifest.original.json", manifest.raw)
            write_atomic(state / "selection.json", canonical(selection) + b"\n")
            write_atomic(operation_path, canonical(operation) + b"\n")
        database = state / "members.sqlite3"
        if database.is_symlink():
            raise ArchiveError("Refusing symbolic-link extraction journal")
        with contextlib.closing(sqlite3.connect(database)) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("CREATE TABLE IF NOT EXISTS members (ordinal INTEGER PRIMARY KEY, output TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, crc32 TEXT NOT NULL)")
            db.commit()
            complete: list[dict[str, Any]] = []
            written = reused = 0
            infos = archive.infolist()
            # Archive order minimizes reopening/re-hashing original part handles.
            for i in sorted(ordinals, key=lambda n: index["members"][n]["header_offset"]):
                row, output = index["members"][i], mapping[i]
                target = safe_parent(destination, output, directory=row["kind"] == "directory")
                if row["kind"] == "directory":
                    complete.append({"ordinal": i, "path": row["path"], "output": output, "kind": "directory", "bytes": 0})
                    continue
                previous = db.execute("SELECT output,bytes,sha256,crc32 FROM members WHERE ordinal=?", (i,)).fetchone()
                if previous and target.exists():
                    actual_hash, actual_bytes = hash_file(target)
                    if previous != (output, row["bytes"], actual_hash, row["crc32"]) or actual_bytes != row["bytes"]:
                        raise ArchiveError(f"Previously extracted member was edited: {output}; it is preserved")
                    reused += 1
                    complete.append({"ordinal": i, "path": row["path"], "output": output, "kind": "file", "bytes": actual_bytes, "sha256": actual_hash, "crc32": row["crc32"], "original_mode": row["mode"]})
                    continue
                free = shutil.disk_usage(target.parent).free
                if row["bytes"] > free:
                    raise ArchiveError(f"Not enough free space for original member {output}")
                # Temporary bytes are journal-owned, outside all original member paths.
                temp = state / f"member-{i:08d}.partial"
                if temp.is_symlink():
                    raise ArchiveError("Refusing symbolic-link partial file")
                h, count = hashlib.sha256(), 0
                try:
                    with archive.open(infos[i], "r") as source, temp.open("wb") as sink:
                        for block in iter(lambda: source.read(CHUNK), b""):
                            count += len(block)
                            if count > row["bytes"]:
                                raise ArchiveError("Member exceeds declared uncompressed size")
                            sink.write(block)
                            h.update(block)
                        if count != row["bytes"]:
                            raise ArchiveError("Member is shorter than its central-directory size")
                        sink.flush(); os.fsync(sink.fileno())
                    sha = h.hexdigest()
                    # Exclusive link: a race can never silently replace an existing file.
                    try:
                        os.link(temp, target)
                        os.chmod(target, 0o700 if row["mode"] & 0o111 else 0o600)
                        fsync_directory(target.parent)
                        written += 1
                    except FileExistsError:
                        if hash_file(target) != (sha, count):
                            raise ArchiveError(f"Output differs from the original member: {output}; it is preserved") from None
                        reused += 1
                    db.execute("INSERT OR REPLACE INTO members VALUES (?,?,?,?,?)", (i, output, count, sha, row["crc32"]))
                    db.commit()
                    complete.append({"ordinal": i, "path": row["path"], "output": output, "kind": "file", "bytes": count, "sha256": sha, "crc32": row["crc32"], "original_mode": row["mode"]})
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        temp.unlink()
            receipt = {"schema": "ecosystems.parted-zip-receiving/v1", "version": VERSION,
                       "status": "complete-selected-members", "archive": manifest.identity(),
                       "selection_sha256": operation["selection_sha256"], "layout": layout,
                       "members": sorted(complete, key=lambda r: r["ordinal"]),
                       "members_written_this_run": written, "members_reused_this_run": reused,
                       "uncompressed_bytes": sum(r["bytes"] for r in complete),
                       "required_original_part_bytes": plan["required_part_bytes"],
                       "original_archive_bytes": manifest.size,
                       "elapsed_seconds": time.perf_counter() - started, "io": reader.stats()}
            write_atomic(state / "receiving.json", canonical(receipt) + b"\n")
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return receipt


def adopt_part(manifest: Manifest, directory: Path, number: int, source: Path) -> dict[str, Any]:
    integer(number, "Part number", 1)
    if number > len(manifest.parts):
        raise ArchiveError("Part number is outside the manifest")
    part = manifest.parts[number-1]
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink():
        raise ArchiveError("Part destination must not be a symbolic link")
    target = directory / part.filename
    if target.exists():
        if hash_file(target) != (part.sha, part.size):
            raise ArchiveError("An existing part differs; it is preserved")
        return {"status": "reused", "part": number, "filename": part.filename}
    fd, temporary = tempfile.mkstemp(prefix=".receiving-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as sink, open_regular(source) as src:
            before, h, size = file_signature(src), hashlib.sha256(), 0
            for block in iter(lambda: src.read(CHUNK), b""):
                size += len(block)
                if size > part.size:
                    raise ArchiveError("Supplied file is larger than the original part")
                h.update(block); sink.write(block)
            if file_signature(src) != before or (h.hexdigest(), size) != (part.sha, part.size):
                raise ArchiveError("Supplied file does not match this original part")
            sink.flush(); os.fsync(sink.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            if hash_file(target) != (part.sha, part.size):
                raise ArchiveError("A concurrently received part differs") from None
        fsync_directory(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
    return {"status": "received", "part": number, "filename": part.filename, "bytes": part.size, "sha256": part.sha}


def join_archive(manifest: Manifest, directory: Path, target: Path) -> dict[str, Any]:
    missing = [p.description() for p in manifest.parts if not (directory / p.filename).is_file()]
    if missing:
        raise NeedParts(missing, "full-archive")
    if target.exists() or target.is_symlink():
        raise ArchiveError("Choose a new whole-archive output file")
    target.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(target.parent).free < manifest.size:
        raise ArchiveError("Insufficient free space to reconstruct the complete original ZIP")
    fd, temporary = tempfile.mkstemp(prefix=".joining-", dir=target.parent)
    h, total = hashlib.sha256(), 0
    try:
        with PartsIO(manifest, directory) as reader, os.fdopen(fd, "wb") as sink:
            for block in iter(lambda: reader.read(CHUNK), b""):
                sink.write(block); h.update(block); total += len(block)
            if (total, h.hexdigest()) != (manifest.size, manifest.archive_sha):
                raise ArchiveError("Reconstructed complete archive differs from its original identity")
            sink.flush(); os.fsync(sink.fileno())
            os.link(temporary, target)
            fsync_directory(target.parent)
            result = {"status": "complete-original-archive", "archive": manifest.identity(), "io": reader.stats()}
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
    return result


def dump(value: Any, path: Path | None = None) -> None:
    raw = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8") + b"\n"
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() or path.is_symlink():
            raise ArchiveError(f"Output already exists: {path}; choose a new report filename")
        with path.open("xb") as f:
            f.write(raw)
    else:
        sys.stdout.buffer.write(raw)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("bootstrap", "index", "plan", "extract", "adopt", "join"))
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--parts", required=True, type=Path)
    parser.add_argument("--prefix", action="append", default=[])
    parser.add_argument("--member", action="append", default=[])
    parser.add_argument("--ordinal", type=int, action="append", default=[])
    parser.add_argument("--all", action="store_true", dest="all_members")
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--save-selection", type=Path)
    parser.add_argument("--output", type=Path, help="JSON output; a receiving directory for extract; original ZIP path for join")
    parser.add_argument("--html", type=Path, help="Create an offline original-member receiving planner with index")
    parser.add_argument("--layout", choices=("tree", "entries"), default="tree")
    parser.add_argument("--part", type=int)
    parser.add_argument("--file", type=Path)
    args = parser.parse_args(argv)
    started = time.perf_counter()
    try:
        manifest = Manifest(args.manifest, args.manifest_sha256)
        if args.command == "bootstrap":
            pieces = [p.description() for p in manifest.bootstrap()]
            dump({"schema": "ecosystems.parted-zip-bootstrap/v1", "archive": manifest.identity(),
                  "required_parts": pieces, "missing_parts": [p for p in pieces if not (args.parts / p["filename"]).is_file()]}, args.output)
            return 0
        if args.command == "adopt":
            if args.part is None or not args.file:
                raise ArchiveError("adopt requires --part and --file")
            dump(adopt_part(manifest, args.parts, args.part, args.file), args.output)
            return 0
        if args.command == "join":
            if not args.output:
                raise ArchiveError("join requires a new --output ZIP filename")
            dump(join_archive(manifest, args.parts, args.output))
            return 0
        with archive_session(manifest, args.parts) as (reader, archive, index):
            if args.command == "index":
                if args.html:
                    try:
                        from .parted_zip_view import write_view
                    except ImportError:
                        from parted_zip_view import write_view
                    write_view(index, args.html)
                index["io"] = reader.stats()
                index["elapsed_seconds"] = time.perf_counter() - started
                dump(index, args.output)
                return 0
            selectors = args.prefix or args.member or args.ordinal or args.all_members
            if args.selection and selectors:
                raise ArchiveError("Use a saved selection OR explicit selectors, not both")
            ordinals = load_selection(args.selection, index) if args.selection else select(index, args.prefix, args.member, args.ordinal, args.all_members)
            if args.save_selection:
                dump(selection_document(index, ordinals), args.save_selection)
            if args.command == "plan":
                plan = make_plan(manifest, index, ordinals, args.parts, reader)
                plan["io"] = reader.stats()
                dump(plan, args.output)
            else:
                if not args.output:
                    raise ArchiveError("extract requires a new --output receiving directory")
                result = extract(manifest, args.parts, args.output, index, ordinals, reader, archive, args.layout)
                dump({k: v for k, v in result.items() if k != "members"})
            return 0
    except NeedParts as exc:
        dump({"status": "needs-original-parts", "phase": exc.phase, "required_parts": exc.parts,
              "message": str(exc)})
        return 3
    except (ArchiveError, OSError, zipfile.BadZipFile, NotImplementedError, RuntimeError) as exc:
        dump({"status": "error", "message": str(exc), "error_type": type(exc).__name__})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
