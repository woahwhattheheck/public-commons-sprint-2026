"""Streaming, resumable transfer for complete native runtime capsules.

Only standard-library code is required on the receiving host. Archive bytes are
never executed by this module. Paths and complete hashes are checked before use.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile

BLOCK = 1024 * 1024
HEX = re.compile(r"^[0-9a-f]{64}$")
SCHEMA = "upstate.native-runtime-parts/v1"


def stamp():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key: " + key)
            result[key] = value
        return result
    def reject(value):
        raise ValueError("Nonfinite JSON value: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      object_pairs_hook=pairs, parse_constant=reject)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for data in iter(lambda: stream.read(BLOCK), b""):
            h.update(data)
    return h.hexdigest()


def safe_relative(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise ValueError("Invalid relative member path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("Unsafe relative member path: " + name)
    if ":" in path.parts[0]:
        raise ValueError("Drive/URL is not a relative member path")
    return path


def contained(root, name):
    root = Path(root).resolve(strict=True)
    relative = safe_relative(name)
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root):
        raise ValueError("Member escapes receiving directory: " + name)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Transfer member is a symlink: " + name)
    return path


def regular(path):
    if not stat.S_ISREG(Path(path).lstat().st_mode):
        raise ValueError("Expected a regular file: " + str(path))
    return Path(path)


def descriptor(root, path):
    path = regular(path)
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": file_hash(path)}


def check_descriptor(item):
    safe_relative(item["path"])
    if type(item.get("bytes")) is not int or item["bytes"] < 0:
        raise ValueError("Invalid member byte count")
    if not HEX.fullmatch(str(item.get("sha256", ""))):
        raise ValueError("Invalid SHA256")


def verify_file(root, item):
    check_descriptor(item)
    path = regular(contained(root, item["path"]))
    if path.stat().st_size != item["bytes"] or file_hash(path) != item["sha256"]:
        raise ValueError("Changed transfer member: " + item["path"])
    return path


@contextmanager
def lock(path):
    """POSIX operation lock; process death releases it without stale lock removal."""
    import fcntl
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield fd
    finally:
        os.close(fd)


def copy_verified(source, target):
    source = regular(source)
    h = hashlib.sha256()
    size = 0
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        while data := incoming.read(BLOCK):
            h.update(data)
            size += len(data)
            outgoing.write(data)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    return size, h.hexdigest()


def split(archive, destination, part_bytes=8 * BLOCK):
    """Produce complete ordered parts. Matching completed parts are reusable."""
    archive = regular(Path(archive).resolve(strict=True))
    destination = Path(destination).resolve()
    if type(part_bytes) is not int or part_bytes <= 0:
        raise ValueError("part_bytes must be a positive integer")
    if archive.is_relative_to(destination):
        raise ValueError("Keep the original capsule outside its transfer directory")
    destination.mkdir(parents=True, exist_ok=True)
    with lock(destination / ".split.lock"):
        identity = {"name": archive.name, "bytes": archive.stat().st_size,
                    "sha256": file_hash(archive)}
        pending = destination / ".split-operation.json"
        if pending.exists():
            old = read_json(pending)
            if old["archive"] != identity or old["part_bytes"] != part_bytes:
                raise ValueError("This transfer directory belongs to a different original capsule")
        else:
            extras = [p.name for p in destination.iterdir() if p.name != ".split.lock"]
            if extras:
                raise ValueError("Select an empty transfer directory: " + ", ".join(extras[:5]))
            atomic_json(pending, {"archive": identity, "part_bytes": part_bytes})
        h = hashlib.sha256()
        parts = []
        offset = 0
        with archive.open("rb") as stream:
            while offset < identity["bytes"]:
                length = min(part_bytes, identity["bytes"] - offset)
                name = f"{archive.name}.part-{len(parts):06d}"
                path = destination / name
                fd, temporary_name = tempfile.mkstemp(prefix="." + name + ".", dir=destination)
                temporary = Path(temporary_name)
                part_hash = hashlib.sha256()
                with os.fdopen(fd, "wb") as output:
                    remaining = length
                    while remaining:
                        data = stream.read(min(BLOCK, remaining))
                        if not data:
                            raise ValueError("Original capsule changed while splitting")
                        remaining -= len(data)
                        h.update(data)
                        part_hash.update(data)
                        output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                entry = {"path": name, "offset": offset, "bytes": length,
                         "sha256": part_hash.hexdigest()}
                if path.exists():
                    verify_file(destination, entry)
                    temporary.unlink()
                else:
                    os.replace(temporary, path)
                parts.append(entry)
                offset += length
        if h.hexdigest() != identity["sha256"] or archive.stat().st_size != identity["bytes"]:
            raise ValueError("Original capsule changed while splitting")
        manifest = {"schema": SCHEMA, "archive": identity,
                    "part_bytes": part_bytes, "parts": parts}
        atomic_json(destination / "transfer.json", manifest)
        return manifest


def check_parts(manifest):
    if manifest.get("schema") != SCHEMA:
        raise ValueError("Select an upstate native-runtime transfer manifest")
    identity = manifest["archive"]
    if len(safe_relative(identity["name"]).parts) != 1:
        raise ValueError("Capsule name must be a basename")
    check_descriptor({"path": identity["name"], **identity})
    offset = 0
    seen = set()
    for item in manifest["parts"]:
        check_descriptor(item)
        if item["path"] in seen or item.get("offset") != offset or item["bytes"] == 0:
            raise ValueError("Duplicate, empty, missing or overlapping transfer part")
        seen.add(item["path"])
        offset += item["bytes"]
    if offset != identity["bytes"]:
        raise ValueError("Part population is incomplete")
    return identity


def join(manifest_path, destination):
    """Resume at complete part boundaries; incomplete last bytes are retained on failure.

    An incomplete final part resumes after its already-written prefix has been
    compared byte-for-byte to the verified original part; matching bytes are kept.
    No existing completed destination or unrelated partial file is replaced.
    """
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest = read_json(manifest_path)
    identity = check_parts(manifest)
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name("." + destination.name + ".partial")
    state_path = destination.with_name("." + destination.name + ".receiving.json")
    signature = hashlib.sha256(canonical(manifest)).hexdigest()
    with lock(destination.with_name("." + destination.name + ".receiving.lock")):
        if destination.exists():
            regular(destination)
            if destination.stat().st_size == identity["bytes"] and file_hash(destination) == identity["sha256"]:
                return {"state": "complete", "reused": True, "path": str(destination), **identity}
            raise ValueError("Receiving destination already contains different bytes")
        if state_path.exists():
            state = read_json(state_path)
            if state.get("transfer_sha256") != signature:
                raise ValueError("Partial receiving belongs to a different transfer")
        else:
            if partial.exists():
                raise ValueError("Unowned partial file exists; preserve it and choose another destination")
            atomic_json(state_path, {"transfer_sha256": signature, "state": "receiving",
                                     "started_at": stamp()})
        if partial.is_symlink():
            raise ValueError("Partial receiving cannot be a symlink")
        with partial.open("a+b") as output:
            if output.tell() > identity["bytes"]:
                raise ValueError("Partial receiving exceeds the original capsule")
            for item in manifest["parts"]:
                source = verify_file(manifest_path.parent, item)
                output.seek(0, os.SEEK_END)
                size = output.tell()
                prefix_bytes = max(0, min(item["bytes"], size - item["offset"]))
                if prefix_bytes:
                    output.seek(item["offset"])
                    with source.open("rb") as incoming:
                        remaining = prefix_bytes
                        while remaining:
                            step = min(BLOCK, remaining)
                            if output.read(step) != incoming.read(step):
                                raise ValueError("Partial receiving differs at part " + item["path"])
                            remaining -= step
                if prefix_bytes == item["bytes"]:
                    continue
                if size < item["offset"]:
                    raise ValueError("Partial receiving has a gap")
                with source.open("rb") as incoming:
                    incoming.seek(prefix_bytes)
                    output.seek(0, os.SEEK_END)
                    for data in iter(lambda: incoming.read(BLOCK), b""):
                        output.write(data)
                output.flush()
                os.fsync(output.fileno())
                atomic_json(state_path, {"transfer_sha256": signature, "state": "receiving",
                                         "verified_bytes": item["offset"] + item["bytes"],
                                         "updated_at": stamp()})
        if partial.stat().st_size != identity["bytes"] or file_hash(partial) != identity["sha256"]:
            raise ValueError("Joined capsule differs from the retained original")
        # Hard-link publication is create-only, including against a competing writer.
        os.link(partial, destination)
        partial.unlink()
        result = {"state": "complete", "reused": False, "path": str(destination),
                  "transfer_sha256": signature, **identity}
        atomic_json(state_path, result)
        return result
