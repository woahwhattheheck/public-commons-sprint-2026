"""Incremental, resumable transport of original Upstate workspace archives.

TokenJunkieLabs. Python 3.10+, standard library only. This module transfers
retained bytes; native model execution and native restore stay with their owners.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import time
import uuid
import zipfile
from typing import Any, BinaryIO, Callable, Iterable, Iterator

FORMAT = "upstate.project-transfer/v1"
ARCHIVE_FORMAT = "upstate.scientific-workspace-archive/v1"
WORKSPACE_SCHEMA = "upstate.scientific-workbench/v1"
PACK_FORMAT = "upstate.project-transfer-pack/v1"
REQUEST_FORMAT = "upstate.project-transfer-request/v1"
MAX_MANIFEST = 64 * 1024 * 1024
DEFAULT_BLOCK = 4 * 1024 * 1024
MAX_BLOCK = 64 * 1024 * 1024
READ_SIZE = 1024 * 1024
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_JSON = dict[str, Any]
Progress = Callable[[_JSON], None]


class TransferError(ValueError):
    """A transfer input is inconsistent; retained good blocks remain reusable."""


class Cancelled(TransferError):
    """Explicit cancellation at a durable block boundary."""


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_id(value: Any) -> str:
    if not isinstance(value, str) or not _DIGEST.fullmatch(value):
        raise TransferError("Expected a lowercase SHA-256 identity")
    return value


def integer(value: Any, *, minimum: int = 0, maximum: int | None = None) -> int:
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise TransferError("Invalid byte count or integer option")
    return value


def member_name(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise TransferError("Invalid retained member path")
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or str(p) != value or any(x in (".", "..") for x in p.parts):
        raise TransferError("Retained paths must be canonical and relative")
    # No drive or alternate-data-stream paths on a Windows receiving machine.
    if any(":" in x for x in p.parts):
        raise TransferError("Retained paths must not contain drive/stream separators")
    return value


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with regular_reader(path) as f:
        for block in iter(lambda: f.read(READ_SIZE), b""):
            h.update(block)
    return h.hexdigest()


@contextlib.contextmanager
def regular_reader(path: Path) -> Iterator[BinaryIO]:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise TransferError("Expected a regular retained file")
        with os.fdopen(fd, "rb", closefd=False) as f:
            yield f
    finally:
        os.close(fd)


def _sync_dir(path: Path) -> None:
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _atomic(path: Path, data: bytes, *, replace: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    tmp = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if replace:
            if path.is_symlink():
                raise TransferError("Refusing a cache symlink")
            os.replace(tmp, path)
        else:
            try:
                os.link(tmp, path)
            except FileExistsError:
                with regular_reader(path) as existing:
                    if existing.read(len(data) + 1) != data:
                        raise TransferError("Identity already exists with different bytes")
        _sync_dir(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def load_json(path: Path, *, maximum: int = MAX_MANIFEST) -> _JSON:
    with regular_reader(path) as f:
        data = f.read(maximum + 1)
    if len(data) > maximum:
        raise TransferError("Manifest exceeds configured metadata limit")
    return parse_json(data)


def parse_json(data: bytes) -> _JSON:
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise TransferError("Duplicate JSON member")
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(TransferError("Nonfinite JSON")))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TransferError("Invalid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise TransferError("Expected a JSON object")
    return value


def _identity(path: Path) -> tuple[int, ...]:
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise TransferError("Input must be an original regular archive")
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def _zip_inventory(z: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    rows: dict[str, zipfile.ZipInfo] = {}
    for info in z.infolist():
        name = member_name(info.filename)
        mode = info.external_attr >> 16
        if name in rows or info.is_dir() or stat.S_ISLNK(mode) or info.flag_bits & 1:
            raise TransferError("ZIP members must be unique unencrypted regular files")
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG):
            raise TransferError("ZIP contains a special file")
        rows[name] = info
    return rows


def _archive_manifest(z: zipfile.ZipFile, rows: dict[str, zipfile.ZipInfo]) -> tuple[_JSON, bytes]:
    if "ARCHIVE.json" not in rows or rows["ARCHIVE.json"].file_size > MAX_MANIFEST:
        raise TransferError("Original workspace ARCHIVE.json is missing or too large")
    raw = z.read(rows["ARCHIVE.json"])
    value = parse_json(raw)
    if value.get("schema") != ARCHIVE_FORMAT:
        raise TransferError("Select an original Upstate scientific-workspace archive")
    project = value.get("project")
    members = value.get("members")
    if not isinstance(project, dict) or project.get("schema") != WORKSPACE_SCHEMA or not isinstance(project.get("id"), str) or not project["id"]:
        raise TransferError("Original project identity is missing")
    if not isinstance(members, dict) or set(rows) != set(members) | {"ARCHIVE.json"}:
        raise TransferError("Original manifest and ZIP inventory disagree")
    if "workspace/workspace.json" not in members:
        raise TransferError("Original workspace identity file is missing")
    for name, record in members.items():
        member_name(name)
        if not name.startswith(("workspace/", "application/")) or not isinstance(record, dict):
            raise TransferError("Unexpected original archive namespace or record")
        if rows[name].file_size != integer(record.get("bytes")):
            raise TransferError("Original archive member length differs: " + name)
        digest_id(record.get("sha256"))
    if rows["workspace/workspace.json"].file_size > MAX_MANIFEST:
        raise TransferError("Project identity file is too large")
    if parse_json(z.read(rows["workspace/workspace.json"])) != project:
        raise TransferError("Original project identity differs from archive manifest")
    return value, raw


def validate_snapshot(value: _JSON) -> _JSON:
    if not isinstance(value, dict) or value.get("schema") != FORMAT:
        raise TransferError("Unsupported transfer snapshot")
    if set(value) != {"schema", "id", "chunk_bytes", "archive", "members"}:
        raise TransferError("Unexpected snapshot fields")
    expected_id = digest_id(value.get("id"))
    core = {k: v for k, v in value.items() if k != "id"}
    if sha(canonical(core)) != expected_id:
        raise TransferError("Snapshot identity differs from its contents")
    chunk_size = integer(value.get("chunk_bytes"), minimum=65536, maximum=MAX_BLOCK)
    archive = value.get("archive")
    if not isinstance(archive, dict) or archive.get("schema") != ARCHIVE_FORMAT:
        raise TransferError("Snapshot lacks its original archive manifest")
    if not isinstance(archive.get("project"), dict) or archive["project"].get("schema") != WORKSPACE_SCHEMA or not isinstance(archive["project"].get("id"), str):
        raise TransferError("Snapshot lacks the original project")
    rows = value.get("members")
    original = archive.get("members")
    if not isinstance(rows, dict) or not isinstance(original, dict) or set(rows) != set(original) | {"ARCHIVE.json"}:
        raise TransferError("Snapshot and original member inventory disagree")
    if "workspace/workspace.json" not in original:
        raise TransferError("Original project identity is absent")
    block_sizes: dict[str, int] = {}
    for name, item in rows.items():
        member_name(name)
        if name != "ARCHIVE.json" and not name.startswith(("workspace/", "application/")):
            raise TransferError("Unexpected member namespace")
        if not isinstance(item, dict) or set(item) != {"bytes", "sha256", "blocks"}:
            raise TransferError("Malformed retained file record")
        length = integer(item.get("bytes"))
        digest_id(item.get("sha256"))
        if name in original and (not isinstance(original[name], dict) or length != original[name].get("bytes") or item["sha256"] != original[name].get("sha256")):
            raise TransferError("Snapshot changed an original file identity")
        archive_member_mode(value, name)
        blocks = item.get("blocks")
        if not isinstance(blocks, list):
            raise TransferError("Expected ordered file blocks")
        total = 0
        for index, block in enumerate(blocks):
            if not isinstance(block, dict) or set(block) != {"sha256", "bytes"}:
                raise TransferError("Malformed block record")
            key = digest_id(block.get("sha256"))
            size = integer(block.get("bytes"), minimum=1, maximum=chunk_size)
            if index < len(blocks) - 1 and size != chunk_size:
                raise TransferError("Nonfinal blocks must have the declared chunk size")
            if key in block_sizes and block_sizes[key] != size:
                raise TransferError("One block identity has conflicting lengths")
            block_sizes[key] = size
            total += size
        if total != length or (length == 0 and item["sha256"] != sha(b"")):
            raise TransferError("Blocks do not reproduce retained file length")
    return value


def archive_member_mode(snapshot: _JSON, name: str) -> int | None:
    """Preserve the original optional native file mode without changing identities."""
    mode = snapshot["archive"]["members"].get(name, {}).get("mode")
    if mode is None:
        return None
    if not isinstance(mode, str) or mode not in {"100644", "100755"}:
        raise TransferError("Unsupported original archive member mode: " + name)
    return int(mode, 8)


def block_inventory(snapshot: _JSON) -> dict[str, int]:
    return {b["sha256"]: b["bytes"] for item in snapshot["members"].values() for b in item["blocks"]}


class TransferStore:
    """Owned disk cache; snapshots are immutable and blocks deduplicate by bytes.

    Keep the store OUTSIDE a live Workspace. No garbage collection is implicit:
    a transfer cannot discard a receiver's independently retained project.
    """
    def __init__(self, root: str | Path):
        self.root = Path(root).absolute()
        self._verified: dict[str, tuple[int, ...]] = {}
        if self.root.is_symlink():
            raise TransferError("Store root must not be a symlink")
        for name in ("blocks", "snapshots", "partials", "operations"):
            target = self.root / name
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target.is_symlink():
                raise TransferError("Store directories must not be symlinks")

    def block_path(self, identity: str) -> Path:
        key = digest_id(identity)
        directory = self.root / "blocks" / key[:2]
        if directory.is_symlink():
            raise TransferError("Block directory must not be a symlink")
        return directory / key

    def has_block(self, identity: str, size: int, *, verify: bool = True) -> bool:
        path = self.block_path(identity)
        try:
            stamp = _identity(path)
            if stamp[2] != size:
                return False
            if not verify:
                return True
            if self._verified.get(identity) == stamp:
                return True
            if file_hash(path) != identity or _identity(path) != stamp:
                self._verified.pop(identity, None)
                return False
            if len(self._verified) >= 16384:
                self._verified.clear()
            self._verified[identity] = stamp
            return True
        except (FileNotFoundError, TransferError):
            return False

    def put_block(self, data: bytes, *, expected: str | None = None) -> str:
        if not data or len(data) > MAX_BLOCK:
            raise TransferError("Empty or oversized block")
        identity = sha(data)
        if expected is not None and digest_id(expected) != identity:
            raise TransferError("Received block checksum differs")
        path = self.block_path(identity)
        if not self.has_block(identity, len(data)):
            _atomic(path, data, replace=path.exists())
        return identity

    def get_block(self, identity: str, size: int) -> bytes:
        with regular_reader(self.block_path(identity)) as f:
            data = f.read(integer(size, minimum=1, maximum=MAX_BLOCK) + 1)
        if len(data) != size or sha(data) != identity:
            raise TransferError("Retained block is missing or corrupt: " + identity)
        return data

    def accept_snapshot(self, snapshot: _JSON) -> str:
        validate_snapshot(snapshot)
        raw = canonical(snapshot)
        if len(raw) > MAX_MANIFEST:
            raise TransferError("Snapshot exceeds configured metadata limit")
        _atomic(self.root / "snapshots" / (snapshot["id"] + ".json"), raw + b"\n")
        return snapshot["id"]

    def snapshot(self, identity: str) -> _JSON:
        return validate_snapshot(load_json(self.root / "snapshots" / (digest_id(identity) + ".json")))

    def list_snapshots(self) -> list[_JSON]:
        results = []
        for path in sorted((self.root / "snapshots").glob("*.json")):
            value = validate_snapshot(load_json(path))
            inv = block_inventory(value)
            results.append({"id": value["id"], "project": value["archive"]["project"],
                            "files": len(value["members"]) - 1,
                            "logical_bytes": sum(x["bytes"] for x in value["members"].values()),
                            "unique_blocks": len(inv), "unique_bytes": sum(inv.values()),
                            "created_at": value["archive"].get("created_at")})
        return results

    def capture_archive(self, archive_path: str | Path, *, chunk_bytes: int = DEFAULT_BLOCK,
                        progress: Progress | None = None, cancel: Callable[[], bool] | None = None) -> _JSON:
        """Index a completed original portable.backup ZIP, preserving all bytes.

        An interrupted index can be repeated: already checked blocks are reused.
        No complete snapshot appears until every declared file matches.
        """
        chunk_bytes = integer(chunk_bytes, minimum=65536, maximum=MAX_BLOCK)
        path = Path(archive_path).absolute()
        before = _identity(path)
        members: _JSON = {}
        start = time.monotonic()
        captured = 0
        with regular_reader(path) as f, zipfile.ZipFile(f) as z:
            rows = _zip_inventory(z)
            original, _ = _archive_manifest(z, rows)
            total_bytes = sum(x.file_size for x in rows.values())
            for name in sorted(rows):
                h = hashlib.sha256()
                blocks = []
                size = 0
                with z.open(rows[name]) as source:
                    while True:
                        if cancel and cancel():
                            raise Cancelled("Capture paused; received blocks remain retained")
                        data = source.read(chunk_bytes)
                        if not data:
                            break
                        key = self.put_block(data)
                        blocks.append({"sha256": key, "bytes": len(data)})
                        h.update(data)
                        size += len(data)
                        captured += len(data)
                        if progress:
                            progress({"phase": "capturing", "path": name, "bytes_done": captured,
                                      "bytes_total": total_bytes, "seconds": time.monotonic() - start})
                item = {"bytes": size, "sha256": h.hexdigest(), "blocks": blocks}
                if name in original["members"]:
                    declared = original["members"][name]
                    if size != declared["bytes"] or h.hexdigest() != declared["sha256"]:
                        raise TransferError("Original retained file checksum differs: " + name)
                members[name] = item
        if _identity(path) != before:
            raise TransferError("Original archive changed during capture")
        core = {"schema": FORMAT, "chunk_bytes": chunk_bytes, "archive": original, "members": members}
        result = {**core, "id": sha(canonical(core))}
        self.accept_snapshot(result)
        if progress:
            progress({"phase": "captured", "snapshot_id": result["id"], "bytes_done": captured,
                      "bytes_total": captured, "seconds": time.monotonic() - start})
        return result

    def needs(self, identity: str, *, verify: bool = True) -> _JSON:
        value = self.snapshot(identity)
        inventory = block_inventory(value)
        missing = []
        for key, size in sorted(inventory.items()):
            if not self.has_block(key, size, verify=verify):
                part = self.root / "partials" / (key + ".part")
                offset = 0
                if part.exists() and not part.is_symlink():
                    offset = min(part.stat().st_size, size)
                # A full partial still needs final digest verification.
                missing.append({"sha256": key, "bytes": size, "offset": offset})
        total = sum(inventory.values())
        wanted = sum(x["bytes"] for x in missing)
        return {"schema": REQUEST_FORMAT, "snapshot_id": identity,
                "project_id": value["archive"]["project"]["id"],
                "blocks_total": len(inventory), "bytes_total": total,
                "blocks_present": len(inventory) - len(missing), "bytes_present": total - wanted,
                "bytes_remaining": sum(x["bytes"] - x["offset"] for x in missing),
                "bytes_for_whole_block_packs": wanted,
                "complete": not missing, "missing": missing}

    def difference(self, before_id: str, after_id: str) -> _JSON:
        before, after = self.snapshot(before_id), self.snapshot(after_id)
        a, b = before["members"], after["members"]
        added, removed, changed, unchanged = [], [], [], []
        for name in sorted(set(a) | set(b)):
            if name == "ARCHIVE.json":
                continue
            if name not in a:
                added.append(name)
            elif name not in b:
                removed.append(name)
            elif a[name]["sha256"] == b[name]["sha256"] and a[name]["bytes"] == b[name]["bytes"]:
                unchanged.append(name)
            else:
                changed.append(name)
        old, new = block_inventory(before), block_inventory(after)
        return {"schema": "upstate.project-transfer-difference/v1", "from_id": before_id,
                "to_id": after_id, "same_project": before["archive"]["project"]["id"] == after["archive"]["project"]["id"],
                "added": added, "removed": removed, "changed": changed, "unchanged": unchanged,
                "new_unique_bytes": sum(size for key, size in new.items() if key not in old),
                "reusable_bytes": sum(size for key, size in new.items() if key in old),
                "meaning": "Removed files are omitted only from the new receiving copy; older copies are unchanged."}

    def receive_block(self, snapshot_id: str, identity: str, source: BinaryIO, *, offset: int = 0,
                      length: int | None = None, progress: Progress | None = None) -> _JSON:
        """Receive a declared block range; interrupted prefixes survive restarts.

        The caller serializes concurrent uploads for one block. A disk lock is
        provided here on supported systems; no stale PID lock files are used.
        """
        snapshot = self.snapshot(snapshot_id)
        inventory = block_inventory(snapshot)
        key = digest_id(identity)
        if key not in inventory:
            raise TransferError("Block is not declared by the selected snapshot")
        expected_size = inventory[key]
        offset = integer(offset, maximum=expected_size)
        if length is not None:
            length = integer(length, maximum=expected_size - offset)
        with self._block_lock(key):
            if self.has_block(key, expected_size):
                return {"sha256": key, "bytes": expected_size, "offset": expected_size, "complete": True, "reused": True}
            path = self.root / "partials" / (key + ".part")
            if path.is_symlink():
                raise TransferError("Partial block must not be a symlink")
            actual = path.stat().st_size if path.exists() else 0
            if actual != offset:
                raise TransferError("Resume offset differs; refresh the receiver request")
            with path.open("ab") as out:
                remaining = expected_size - actual if length is None else length
                while remaining:
                    block = source.read(min(READ_SIZE, remaining))
                    if not block:
                        break
                    out.write(block)
                    actual += len(block)
                    remaining -= len(block)
                out.flush()
                os.fsync(out.fileno())
            _sync_dir(path.parent)
            complete = False
            if actual == expected_size:
                if file_hash(path) != key:
                    path.unlink()
                    raise TransferError("Block checksum differs; retry this block from offset zero")
                target = self.block_path(key)
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.is_symlink():
                    raise TransferError("Retained block is a symlink")
                os.replace(path, target)
                _sync_dir(target.parent)
                complete = True
            value = {"sha256": key, "bytes": expected_size, "offset": actual, "complete": complete, "reused": False}
            if progress:
                progress({"phase": "receiving", **value})
            return value

    @contextlib.contextmanager
    def _block_lock(self, identity: str):
        path = self.root / "partials" / (digest_id(identity) + ".lock")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags, 0o600)
        try:
            if os.name == "posix":
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX)
            elif os.name == "nt":
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"0")
                os.lseek(fd, 0, 0)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
            yield
        finally:
            os.close(fd)

    def write_pack(self, identity: str, destination: str | Path, *, request: _JSON | None = None,
                   block_ids: Iterable[str] | None = None) -> _JSON:
        """Write one portable ZIP part. Every part carries the same full manifest."""
        snapshot = self.snapshot(identity)
        inventory = block_inventory(snapshot)
        if request is not None:
            if request.get("schema") != REQUEST_FORMAT or request.get("snapshot_id") != identity:
                raise TransferError("Receiver request selects a different snapshot")
            wanted = [digest_id(row["sha256"]) for row in request.get("missing", [])]
        else:
            wanted = list(inventory)
        if block_ids is not None:
            subset = list(block_ids)
            allowed = set(wanted)
            if any(key not in allowed for key in subset):
                raise TransferError("Part contains blocks outside receiver request")
            wanted = subset
        wanted = sorted(set(wanted))
        if any(key not in inventory for key in wanted):
            raise TransferError("Receiver asked for undeclared data")
        path = Path(destination).absolute()
        if path.exists():
            raise TransferError("Choose a new pack path")
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".pack-", dir=path.parent)
        os.close(fd)
        tmp = Path(name)
        try:
            with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
                z.writestr("TRANSFER.json", canonical(snapshot) + b"\n")
                z.writestr("PACK.json", canonical({"schema": PACK_FORMAT, "snapshot_id": identity,
                                                  "blocks": {key: inventory[key] for key in wanted}}) + b"\n")
                for key in wanted:
                    z.writestr("blocks/" + key, self.get_block(key, inventory[key]))
            with tmp.open("rb") as f:
                os.fsync(f.fileno())
            os.link(tmp, path)
            _sync_dir(path.parent)
        finally:
            tmp.unlink(missing_ok=True)
        return {"snapshot_id": identity, "path": str(path), "bytes": path.stat().st_size,
                "sha256": file_hash(path), "blocks": len(wanted),
                "payload_bytes": sum(inventory[key] for key in wanted)}

    def write_parts(self, identity: str, directory: str | Path, *, request: _JSON | None = None,
                    payload_bytes: int = 64 * 1024 * 1024, progress: Progress | None = None) -> list[_JSON]:
        """Deterministic bounded-payload parts, restartable without overwriting.

        Part file overhead is the full snapshot plus ZIP records; payload_bytes
        deliberately describes raw block payload rather than a false file limit.
        """
        payload_bytes = integer(payload_bytes, minimum=1)
        snapshot = self.snapshot(identity)
        inventory = block_inventory(snapshot)
        if request is not None:
            if request.get("schema") != REQUEST_FORMAT or request.get("snapshot_id") != identity:
                raise TransferError("Receiver request selects a different snapshot")
            wanted = sorted(set(digest_id(row["sha256"]) for row in request.get("missing", [])))
        else:
            wanted = sorted(inventory)
        if any(key not in inventory for key in wanted):
            raise TransferError("Receiver asked for undeclared blocks")
        if any(inventory[key] > payload_bytes for key in wanted):
            raise TransferError("Part payload limit must be at least the largest selected block")
        output = Path(directory).absolute()
        output.mkdir(parents=True, exist_ok=True)
        _atomic(output / (identity + ".transfer.json"), canonical(snapshot) + b"\n")
        groups: list[list[str]] = []
        batch: list[str] = []
        size = 0
        for key in wanted:
            if batch and size + inventory[key] > payload_bytes:
                groups.append(batch)
                batch, size = [], 0
            batch.append(key)
            size += inventory[key]
        if batch:
            groups.append(batch)
        results = []
        for group in groups:
            group_id = sha(canonical({"snapshot_id": identity, "blocks": group}))
            path = output / (group_id + ".uptransfer.zip")
            if path.exists():
                # Verify complete existing part before treating publication as done.
                actual_snapshot, declared = self.inspect_pack(path, verify=True)
                if actual_snapshot["id"] != identity or set(declared) != set(group):
                    raise TransferError("Existing deterministic pack differs")
                result = {"snapshot_id": identity, "path": str(path), "bytes": path.stat().st_size,
                          "sha256": file_hash(path), "blocks": len(group),
                          "payload_bytes": sum(inventory[key] for key in group), "reused": True}
            else:
                result = self.write_pack(identity, path, request=request, block_ids=group)
            results.append(result)
            if progress:
                progress({"phase": "packing", "parts_done": len(results), "parts_total": len(groups), **result})
        index = {"schema": "upstate.project-transfer-parts/v1", "snapshot_id": identity,
                 "payload_limit_bytes": payload_bytes,
                 "parts": [{**row, "path": Path(row["path"]).name} for row in results]}
        index_name = sha(canonical({"snapshot_id": identity, "wanted": wanted, "payload_limit_bytes": payload_bytes})) + ".parts.json"
        _atomic(output / index_name, canonical(index) + b"\n", replace=True)
        return results

    @staticmethod
    def inspect_pack(path: str | Path, *, verify: bool = True) -> tuple[_JSON, dict[str, int]]:
        with regular_reader(Path(path)) as f, zipfile.ZipFile(f) as z:
            entries = _zip_inventory(z)
            for name in ("TRANSFER.json", "PACK.json"):
                if name not in entries or entries[name].file_size > MAX_MANIFEST:
                    raise TransferError("Pack metadata missing or oversized")
            snapshot = validate_snapshot(parse_json(z.read(entries["TRANSFER.json"])))
            pack = parse_json(z.read(entries["PACK.json"]))
            if pack.get("schema") != PACK_FORMAT or pack.get("snapshot_id") != snapshot["id"]:
                raise TransferError("Pack snapshot identity differs")
            blocks = pack.get("blocks")
            inventory = block_inventory(snapshot)
            if not isinstance(blocks, dict) or set(entries) != {"TRANSFER.json", "PACK.json"} | {"blocks/" + k for k in blocks}:
                raise TransferError("Pack member inventory differs")
            for key, size in blocks.items():
                digest_id(key)
                integer(size, minimum=1, maximum=MAX_BLOCK)
                if inventory.get(key) != size or entries["blocks/" + key].file_size != size:
                    raise TransferError("Pack block not declared by original snapshot")
                if verify:
                    data = z.read(entries["blocks/" + key])
                    if sha(data) != key:
                        raise TransferError("Pack contains a corrupt block")
            return snapshot, blocks

    def receive_pack(self, path: str | Path, *, progress: Progress | None = None,
                     cancel: Callable[[], bool] | None = None) -> _JSON:
        path = Path(path).absolute()
        before = _identity(path)
        snapshot, declared = self.inspect_pack(path, verify=False)
        self.accept_snapshot(snapshot)
        reused, received = 0, 0
        with regular_reader(path) as f, zipfile.ZipFile(f) as z:
            for key, size in declared.items():
                if cancel and cancel():
                    raise Cancelled("Receive paused; complete checked blocks remain reusable")
                if self.has_block(key, size):
                    reused += size
                else:
                    data = z.read("blocks/" + key)
                    if len(data) != size:
                        raise TransferError("Received block length differs")
                    self.put_block(data, expected=key)
                    received += size
                if progress:
                    progress({"phase": "receiving", "snapshot_id": snapshot["id"],
                              "received_bytes": received, "reused_bytes": reused})
        if _identity(path) != before:
            raise TransferError("Part changed during receiving")
        result = self.needs(snapshot["id"])
        result.update({"received_bytes": received, "reused_bytes": reused})
        return result

    def materialize_archive(self, identity: str, destination: str | Path, *,
                            compression: int = zipfile.ZIP_STORED, progress: Progress | None = None,
                            cancel: Callable[[], bool] | None = None) -> _JSON:
        """Rebuild a native-compatible archive; no transported code is executed."""
        snapshot = self.snapshot(identity)
        needs = self.needs(identity)
        if not needs["complete"]:
            raise TransferError("Receive the missing blocks before rebuilding the native archive")
        target = Path(destination).absolute()
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            # An exact previous reconstruction is a safe replay, not an overwrite.
            self.verify_archive(identity, target)
            return {"snapshot_id": identity, "path": str(target), "bytes": target.stat().st_size,
                    "sha256": file_hash(target), "identity": "MATCH", "reused": True}
        fd, name = tempfile.mkstemp(prefix=".native-archive-", dir=target.parent)
        os.close(fd)
        pending = Path(name)
        done = 0
        try:
            with zipfile.ZipFile(pending, "w", compression=compression, allowZip64=True) as z:
                for name, item in sorted(snapshot["members"].items()):
                    h = hashlib.sha256()
                    size = 0
                    member = zipfile.ZipInfo(name)
                    member.create_system = 3
                    member.compress_type = compression
                    member.external_attr = (archive_member_mode(snapshot, name) or 0o100644) << 16
                    with z.open(member, "w", force_zip64=True) as output:
                        for block in item["blocks"]:
                            if cancel and cancel():
                                raise Cancelled("Archive assembly paused; all received blocks remain retained")
                            data = self.get_block(block["sha256"], block["bytes"])
                            output.write(data)
                            h.update(data)
                            size += len(data)
                    if size != item["bytes"] or h.hexdigest() != item["sha256"]:
                        raise TransferError("Retained block order does not reproduce original member")
                    done += 1
                    if progress:
                        progress({"phase": "assembling", "path": name, "files_done": done,
                                  "files_total": len(snapshot["members"])})
            self.verify_archive(identity, pending)
            with pending.open("rb") as f:
                os.fsync(f.fileno())
            os.link(pending, target)
            _sync_dir(target.parent)
        finally:
            pending.unlink(missing_ok=True)
        return {"snapshot_id": identity, "path": str(target), "bytes": target.stat().st_size,
                "sha256": file_hash(target), "identity": "MATCH", "reused": False}

    def verify_archive(self, identity: str, path: str | Path) -> None:
        snapshot = self.snapshot(identity)
        with regular_reader(Path(path)) as f, zipfile.ZipFile(f) as z:
            rows = _zip_inventory(z)
            original, _ = _archive_manifest(z, rows)
            if original != snapshot["archive"] or set(rows) != set(snapshot["members"]):
                raise TransferError("Reconstructed archive has different original metadata or files")
            for name, item in snapshot["members"].items():
                mode = archive_member_mode(snapshot, name)
                if mode is not None and rows[name].external_attr >> 16 != mode:
                    raise TransferError("Reconstructed archive has a different original file mode; choose a new archive path: " + name)
                h = hashlib.sha256()
                length = 0
                with z.open(rows[name]) as source:
                    for block in iter(lambda: source.read(READ_SIZE), b""):
                        length += len(block)
                        h.update(block)
                if length != item["bytes"] or h.hexdigest() != item["sha256"]:
                    raise TransferError("Reconstructed archive differs: " + name)

    def report(self, identity: str) -> _JSON:
        value = self.snapshot(identity)
        request = self.needs(identity)
        logical = sum(x["bytes"] for x in value["members"].values())
        return {"schema": "upstate.project-transfer-report/v1", "snapshot_id": identity,
                "project": value["archive"]["project"], "selection": value["archive"].get("selection", {}),
                "file_count": len(value["members"]) - 1, "logical_bytes": logical,
                "unique_bytes": request["bytes_total"], "deduplicated_bytes": logical - request["bytes_total"],
                "request": request,
                **({"source_acquisitions": value["archive"]["source_acquisitions"]}
                   if "source_acquisitions" in value["archive"] else {}),
                **({"parameter_studies": value["archive"]["parameter_studies"]}
                   if "parameter_studies" in value["archive"] else {}),
                **({"implementation": value["archive"]["implementation"]}
                   if "implementation" in value["archive"] else {}),
                "files": [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"],
                           "blocks": len(item["blocks"])} for name, item in sorted(value["members"].items())],
                "next_operation": "materialize_archive then original portable.restore" if request["complete"] else "receive missing blocks"}


def _publish_directory(source: Path, target: Path) -> None:
    """Atomic no-replace publication; never replace even an empty directory."""
    if os.name == "nt":
        os.rename(source, target)  # Windows rename refuses an existing target.
    elif __import__("sys").platform.startswith("linux"):
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        rename = getattr(libc, "renameat2", None)
        if rename is None:
            raise TransferError("This system needs native archive receiving: renameat2 is unavailable")
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1):
            err = ctypes.get_errno()
            raise OSError(err, os.strerror(err), str(target))
    elif __import__("sys").platform == "darwin":
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        rename = libc.renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(os.fsencode(source), os.fsencode(target), 4):  # RENAME_EXCL
            err = ctypes.get_errno()
            raise OSError(err, os.strerror(err), str(target))
    else:
        raise TransferError("Use native archive receiving on this operating system")
    _sync_dir(target.parent)


def receive_directory(store: TransferStore, identity: str, destination: str | Path, *,
                      progress: Progress | None = None,
                      cancel: Callable[[], bool] | None = None) -> _JSON:
    """Receive every original file into a new, independently editable project.

    No application code is executed. Completed files survive interruption. The
    original native restore is additionally available in project_transfer_workspace.
    A lost final reply is reconciled only for this receiver's recorded operation;
    a pre-existing unrelated directory is never adopted or replaced.
    """
    snapshot = store.snapshot(identity)
    target = Path(destination).absolute()
    if target.is_symlink():
        raise TransferError("Receiving destination must not be a symlink")
    target.parent.mkdir(parents=True, exist_ok=True)
    target = target.parent.resolve() / target.name
    root = store.root.resolve()
    if target == root or root in target.parents or target in root.parents:
        raise TransferError("Receiving copy and transfer cache must be separate directories")
    operation_id = sha(canonical({"snapshot_id": identity, "destination": str(target)}))
    operation_path = store.root / "operations" / (operation_id + ".receive.json")
    lock_id = sha(str(target).encode("utf-8"))
    staging = target.parent / (".transfer-receive-" + operation_id)
    with store._block_lock(lock_id):
        operation = load_json(operation_path) if operation_path.exists() else None
        if operation is None:
            if target.exists() or staging.exists():
                raise TransferError("Choose a new receiving directory; existing work is preserved")
            operation = {"schema": "upstate.project-transfer-receiving/v1", "operation_id": operation_id,
                         "snapshot_id": identity, "destination": str(target), "state": "receiving",
                         "project": snapshot["archive"]["project"], "created_at": time.time()}
            _atomic(operation_path, canonical(operation) + b"\n")
        elif operation.get("snapshot_id") != identity or operation.get("destination") != str(target):
            raise TransferError("Saved receiving operation differs")
        if operation["state"] == "complete":
            # Return the original receipt without replacing recipient edits.
            if target.exists():
                project = load_json(target / "workspace" / "workspace.json")
                if project.get("id") != snapshot["archive"]["project"]["id"]:
                    raise TransferError("The previous receiving path now contains another project")
                return {**operation, "reused": True, "receipt_kind": "previously_completed_receiving"}
            operation.update(state="receiving", previous_completed_at=operation.get("completed_at"))
            _atomic(operation_path, canonical(operation) + b"\n", replace=True)
        if target.exists():
            # Final rename can precede the receipt if the process dies. Only an
            # already-recorded publishing operation may reconcile this outcome.
            if operation["state"] != "publishing":
                raise TransferError("Destination appeared during receiving; choose another path")
            verify_directory(store, identity, target)
        else:
            if not store.needs(identity)["complete"]:
                raise TransferError("Receive missing blocks before opening the complete project")
            staging.mkdir(mode=0o700, exist_ok=True)
            if staging.is_symlink():
                raise TransferError("Receiving stage must be an owned directory")
            done = 0
            reused = 0
            for name, record in sorted(snapshot["members"].items()):
                if cancel and cancel():
                    raise Cancelled("Project receiving paused; completed files and blocks remain retained")
                output = staging.joinpath(*PurePosixPath(member_name(name)).parts)
                output.parent.mkdir(parents=True, exist_ok=True)
                for parent in (output, *output.parents):
                    if parent == staging.parent:
                        break
                    if parent.is_symlink():
                        raise TransferError("Receiving stage contains a symlink")
                if output.exists() and output.stat().st_size == record["bytes"] and file_hash(output) == record["sha256"]:
                    reused += 1
                else:
                    fd, pending_name = tempfile.mkstemp(prefix=".transfer-file-", dir=output.parent)
                    pending = Path(pending_name)
                    try:
                        h = hashlib.sha256()
                        with os.fdopen(fd, "wb") as sink:
                            for block in record["blocks"]:
                                if cancel and cancel():
                                    raise Cancelled("Receiving paused; complete files remain retained")
                                data = store.get_block(block["sha256"], block["bytes"])
                                sink.write(data)
                                h.update(data)
                            sink.flush()
                            os.fsync(sink.fileno())
                        if pending.stat().st_size != record["bytes"] or h.hexdigest() != record["sha256"]:
                            raise TransferError("Received member differs from original bytes")
                        os.replace(pending, output)  # Only this operation's private stage.
                        _sync_dir(output.parent)
                    finally:
                        pending.unlink(missing_ok=True)
                mode = archive_member_mode(snapshot, name)
                if mode is not None:
                    output.chmod(mode & 0o777)
                done += 1
                if progress:
                    progress({"phase": "receiving_project", "path": name, "files_done": done,
                              "files_total": len(snapshot["members"]), "reused_files": reused})
            verify_directory(store, identity, staging)
            operation.update(state="publishing", files=len(snapshot["members"]), reused_files=reused)
            _atomic(operation_path, canonical(operation) + b"\n", replace=True)
            _publish_directory(staging, target)
        operation.update(state="complete", completed_at=time.time(), directory=str(target),
                         workspace=str(target / "workspace"), application=str(target / "application"),
                         identity="MATCH", native_cli_present=(target / "application/model/cli.py").is_file(),
                         validation="Every retained original member matched when receiving completed; no application code executed.")
        _atomic(operation_path, canonical(operation) + b"\n", replace=True)
        return {**operation, "reused": False}


def verify_directory(store: TransferStore, identity: str, directory: str | Path) -> _JSON:
    snapshot = store.snapshot(identity)
    root = Path(directory).absolute()
    if root.is_symlink():
        raise TransferError("Receiving copy must not be a symlink")
    for name, record in snapshot["members"].items():
        p = root.joinpath(*PurePosixPath(member_name(name)).parts)
        for parent in (p, *p.parents):
            if parent == root.parent:
                break
            if parent.is_symlink():
                raise TransferError("Received project contains a file alias")
        if not p.is_file() or p.stat().st_size != record["bytes"] or file_hash(p) != record["sha256"]:
            raise TransferError("Received copy has different retained bytes: " + name)
        mode = archive_member_mode(snapshot, name)
        if mode is not None and os.name == "posix" and stat.S_IMODE(p.stat().st_mode) != (mode & 0o777):
            raise TransferError("Received copy has a different original file mode: " + name)
    if load_json(root / "workspace" / "workspace.json") != snapshot["archive"]["project"]:
        raise TransferError("Received project identity differs")
    return {"snapshot_id": identity, "directory": str(root), "files": len(snapshot["members"]), "identity": "MATCH"}
