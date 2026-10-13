"""Lossless compact storage for a completed original cloud-cache operation.

Only the maintained cache helper calls this module. Original plan IDs, JSON bytes,
journal records and target/custody files remain unchanged. The JSON envelope is a
storage codec, not a new cache plan or recovery engine.
"""
from __future__ import annotations

import base64
import binascii
import collections
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import zlib

SCHEMA = "commons.cloud-cache-metadata.v1"
PREFIX = b'{"schema":"commons.cloud-cache-metadata.v1",'
MAX_BYTES = 256 * 1024 * 1024
MAX_FILES = 32
MAX_SELECTED_BYTES = 256 * 1024 * 1024
CHUNK = 1024 * 1024


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _read_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
            raise ValueError("Cache metadata must be a regular file up to 256 MiB")
        parts, size = [], 0
        while True:
            block = os.read(fd, CHUNK)
            if not block:
                break
            size += len(block)
            if size > MAX_BYTES:
                raise ValueError("Cache metadata grew beyond its original limit")
            parts.append(block)
        after = os.fstat(fd)
        stamp = lambda item: (item.st_dev, item.st_ino, item.st_size,
                              item.st_mtime_ns, item.st_ctime_ns)
        if stamp(before) != stamp(after) or size != before.st_size:
            raise ValueError("Cache metadata changed during reading")
        return b"".join(parts), after
    finally:
        os.close(fd)


def decode_metadata(raw):
    """Return the exact original bytes; ordinary original JSON remains ordinary."""
    if not raw.startswith(PREFIX):
        return raw
    if len(raw) > MAX_BYTES:
        raise ValueError("Compact cache metadata exceeds its storage limit")
    item = json.loads(raw)
    keys = {"schema", "encoding", "bytes", "sha256", "data"}
    if (not isinstance(item, dict) or set(item) != keys or item["schema"] != SCHEMA
            or item["encoding"] != "gzip+base64"
            or type(item["bytes"]) is not int or not 0 <= item["bytes"] <= MAX_BYTES
            or not isinstance(item["sha256"], str) or len(item["sha256"]) != 64
            or any(character not in "0123456789abcdef" for character in item["sha256"])
            or not isinstance(item["data"], str)):
        raise ValueError("Invalid compact cache metadata envelope")
    try:
        compressed = base64.b64decode(item["data"], validate=True)
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        original = decoder.decompress(compressed, item["bytes"] + 1)
    except (binascii.Error, zlib.error) as exc:
        raise ValueError("Invalid compact cache metadata payload") from exc
    if (len(original) != item["bytes"] or not decoder.eof
            or decoder.unused_data or decoder.unconsumed_tail
            or _hash(original) != item["sha256"]):
        raise ValueError("Compact cache metadata differs from its original bytes")
    return original


def read_metadata_bytes(path):
    # Preserve the original reader's ordinary JSON/path behavior. The explicit
    # compaction operation separately requires bounded regular selected files.
    return decode_metadata(Path(path).read_bytes())


def encode_metadata(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError("Original cache metadata exceeds its storage limit")
    # Compact only real JSON. Keep its exact whitespace, Unicode and numeric
    # representation inside the envelope; plan IDs and journal bases do not change.
    json.loads(raw)
    item = {"schema": SCHEMA, "encoding": "gzip+base64", "bytes": len(raw),
            "sha256": _hash(raw),
            "data": base64.b64encode(gzip.compress(raw, compresslevel=6, mtime=0)).decode("ascii")}
    return (json.dumps(item, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def write_metadata_bytes(path, data, writer, *, new=False):
    """An original mutable checkpoint keeps its chosen storage codec."""
    compact = False
    if not new:
        try:
            with open(path, "rb") as stream:
                if stream.read(len(PREFIX)) == PREFIX:
                    stream.seek(0)
                    decode_metadata(stream.read())
                    compact = True
        except FileNotFoundError:
            pass
    writer(path, encode_metadata(data) if compact else data, new=new)


def summarize(result, *, issue_limit=20):
    """Keep original results in the API; offer small operator output on request."""
    if not isinstance(result, dict) or not isinstance(result.get("entries"), list):
        return result
    entries = result["entries"]
    states = collections.Counter(str(item.get("state", "unknown")) for item in entries)
    issues = [item for item in entries if item.get("error") or item.get("journal_error")
              or item.get("staged_path") or item.get("state") in
              ("preserved", "changed", "missing", "resurrected", "duplicate_returned")]
    value = {key: item for key, item in result.items() if key != "entries"}
    value.update(entry_count=len(entries), state_counts=dict(sorted(states.items())),
                 issue_count=len(issues),
                 issues=[{key: item[key] for key in
                          ("path", "state", "error", "journal_error", "staged_path", "resume")
                          if key in item} for item in issues[:issue_limit]],
                 issues_truncated=len(issues) > issue_limit, report_format="summary")
    allocation = value.get("physical_allocation")
    if isinstance(allocation, dict) and isinstance(allocation.get("entries"), list):
        value["physical_allocation"] = {key: item for key, item in allocation.items()
                                        if key != "entries"}
        value["physical_allocation"]["entry_count"] = len(allocation["entries"])
    return value


def _member_kind(path, raw, plan, plan_path, cache, *, source_plan_path=None):
    value = json.loads(raw)
    if path in (plan_path, source_plan_path):
        if value != plan:
            raise ValueError("The original cache plan changed before compaction")
        return "plan"
    if path == cache.state_path(plan_path):
        if value != cache.load_state(plan_path, plan):
            raise ValueError("The completed original checkpoint changed")
        return "state"
    if not isinstance(value, dict):
        raise ValueError("Additional cache metadata must be its original JSON object")
    expected = {entry["path"] for entry in plan["entries"]}
    entries = value.get("entries")
    paths = [entry.get("path") for entry in entries] if isinstance(entries, list) and all(
        isinstance(entry, dict) for entry in entries) else None
    if paths is None or len(paths) != len(expected) or set(paths) != expected:
        raise ValueError("Additional metadata must describe this exact original selection")
    if value.get("plan_id") == plan["plan_id"] and value.get("ok") is True:
        if any(entry.get("staged_path") or entry.get("error") or entry.get("journal_error")
               for entry in entries):
            raise ValueError("Preserve unresolved original diagnostic records as-is")
        return "completed-report"
    if (value.get("version") == cache.VERSION
            and value.get("operation_id") == plan.get("operation_id")
            and value.get("cache_root") == plan.get("cache_root")
            and value.get("strategy", "retire") == plan.get("strategy", "retire")):
        if plan.get("strategy", "retire") == "coalesce":
            ownership = value.get("ownership")
            retained_ownership = plan.get("ownership")
            fields = ("immutable", "reference", "inode_contract")
            if (not isinstance(ownership, dict) or not isinstance(retained_ownership, dict)
                    or ownership.get("immutable") is not True
                    or not isinstance(ownership.get("reference"), str)
                    or not ownership["reference"].strip()
                    or {key: ownership[key] for key in fields if key in ownership}
                    != {key: retained_ownership[key] for key in fields if key in retained_ownership}
                    or type(value.get("refresh_mtime", True)) is not bool
                    or value.get("refresh_mtime", True) != plan.get("refresh_mtime", True)):
                raise ValueError("Manifest ownership or refresh semantics differ from the original plan")
        by_path = {entry["path"]: entry for entry in plan["entries"]}
        for entry in entries:
            retained_entry = by_path[entry["path"]]
            match = entry.get("match", "complete")
            if match != retained_entry["match"]:
                raise ValueError("Manifest matching differs from the original plan")
            if match == "range":
                offset = entry.get("offset")
                if type(offset) is not int or offset < 0 or offset != retained_entry.get("offset"):
                    raise ValueError("Manifest byte range differs from the original plan")
            elif "offset" in entry:
                raise ValueError("Only the original range selection accepts an offset")
            retained = retained_entry["custody"]
            custody = entry.get("custody")
            try:
                normalized = cache.custody_spec(custody)
            except (cache.CacheError, KeyError, TypeError, OSError) as exc:
                raise ValueError("Manifest custody is incomplete or invalid") from exc
            # The original planner adds its observed Git backing closure after
            # normalizing the manifest; that derived closure is not required
            # in the input, but an explicitly supplied one must match.
            if (normalized != {key: item for key, item in retained.items() if key != "git_backings"}
                    or ("git_backings" in custody
                        and custody["git_backings"] != retained.get("git_backings"))):
                raise ValueError("Manifest custody differs from the original plan")
        return "manifest"
    raise ValueError("Only this operation's manifest or completed reports may be compacted")


def _stamp(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _metadata(fd):
    info = os.fstat(fd)
    return {"mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid,
            "xattrs": {name: os.getxattr(fd, name) for name in os.listxattr(fd)}}


def _finish_candidate(path, encoded, metadata, cache, *, prefix=None, observed=None):
    flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(path, flags | (os.O_CREAT | os.O_EXCL if prefix is None else 0), 0o600)
    try:
        current = os.fstat(fd)
        if prefix is not None:
            # Complete only this operation's exact encoded prefix. The original
            # file remains intact until this private candidate is fully synced.
            if (not encoded.startswith(prefix) or current.st_nlink != 1
                    or _stamp(current) != _stamp(observed)
                    or _stamp(path.stat(follow_symlinks=False)) != _stamp(observed)):
                raise ValueError("Partial metadata candidate changed; preserve its bytes")
        offset = 0 if prefix is None else len(prefix)
        before_allocation = current.st_blocks * 512
        os.lseek(fd, offset, os.SEEK_SET)
        view = memoryview(encoded)[offset:]
        while view:
            count = os.write(fd, view)
            if not count:
                raise OSError("Compact metadata write made no progress")
            view = view[count:]
        info = os.fstat(fd)
        if (info.st_uid, info.st_gid) != (metadata["uid"], metadata["gid"]):
            os.fchown(fd, metadata["uid"], metadata["gid"])
        os.fchmod(fd, metadata["mode"])
        for name in os.listxattr(fd):
            if name not in metadata["xattrs"]:
                os.removexattr(fd, name)
        for name, value in metadata["xattrs"].items():
            os.setxattr(fd, name, value)
        os.fsync(fd)
        allocated = os.fstat(fd).st_blocks * 512 - before_allocation
    finally:
        os.close(fd)
    cache.sync_dir(path.parent)
    return allocated


def _same_metadata(path, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        return _metadata(fd) == expected
    finally:
        os.close(fd)


def _compact_one(path, original, physical, observed, cache):
    logical_sha = _hash(original)
    stage_id = _hash(str(path).encode()) + "-" + logical_sha
    staged = path.parent / (".cache-compact-" + stage_id + ".stage")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if _stamp(os.fstat(fd)) != _stamp(observed):
            raise ValueError("Selected metadata changed before its original owner")
        metadata = _metadata(fd)
    finally:
        os.close(fd)
    released, created = 0, 0
    already = physical.startswith(PREFIX)
    encoded = encode_metadata(original)
    try:
        stage_bytes, stage_info = _read_regular(staged)
    except FileNotFoundError:
        stage_bytes = None
    if stage_bytes is not None:
        complete = False
        try:
            complete = decode_metadata(stage_bytes) == original
        except (ValueError, TypeError):
            pass
        if complete and _same_metadata(staged, metadata):
            if already or not stage_bytes.startswith(PREFIX):
                if (_stamp(path.stat(follow_symlinks=False)) != _stamp(observed)
                        or read_metadata_bytes(path) != original):
                    raise ValueError("Metadata owner changed before staging recovery")
                released += cache.remove_verified(
                    staged, {"sha256": _hash(stage_bytes), "size": len(stage_bytes)})[
                        "last_link_allocated_bytes_unlinked"]
                stage_bytes = None
            else:
                # A prior runtime's valid gzip stream may differ byte-for-byte
                # while retaining the same exact original JSON.
                encoded = stage_bytes
        elif (not already and len(stage_bytes) <= len(encoded)
                and encoded.startswith(stage_bytes)
                and _stamp(path.stat(follow_symlinks=False)) == _stamp(observed)):
            created += _finish_candidate(staged, encoded, metadata, cache,
                                         prefix=stage_bytes, observed=stage_info)
            stage_bytes = encoded
        else:
            raise ValueError("Preserve changed compact-metadata staging: " + str(staged))
    if already:
        if read_metadata_bytes(path) != original:
            raise ValueError("Original compact metadata changed")
        return {"path": str(path), "state": "compacted", "action": "already_compact",
                "original_bytes": len(original), "original_sha256": logical_sha,
                "stored_bytes": len(physical), "last_link_allocated_bytes_unlinked": released,
                "new_metadata_allocated_bytes": 0}
    if len(encoded) >= len(physical):
        return {"path": str(path), "state": "unchanged", "action": "no_storage_reduction",
                "original_bytes": len(original), "original_sha256": logical_sha,
                "stored_bytes": len(physical), "last_link_allocated_bytes_unlinked": released,
                "new_metadata_allocated_bytes": created}
    if stage_bytes is None:
        created += _finish_candidate(staged, encoded, metadata, cache)
    staged_bytes, candidate_info = _read_regular(staged)
    if (staged_bytes != encoded or not _same_metadata(staged, metadata)
            or _stamp(path.stat(follow_symlinks=False)) != _stamp(observed)):
        raise ValueError("Selected metadata or candidate changed; both are preserved")
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    candidate_inode = (candidate_info.st_dev, candidate_info.st_ino)
    try:
        try:
            cache.exchange_file(staged, directory, path.name)
            displaced, displaced_info = _read_regular(staged)
            if (displaced != physical
                    or (displaced_info.st_dev, displaced_info.st_ino) !=
                       (observed.st_dev, observed.st_ino)
                    or not _same_metadata(staged, metadata)):
                raise ValueError("Original metadata changed during compaction")
            if (cache.inode_at(directory, path.name) != candidate_inode
                    or read_metadata_bytes(path) != original
                    or not _same_metadata(path, metadata)):
                raise ValueError("Compact metadata changed after publication")
        except BaseException:
            # This also covers a read/sync failure after renameat2 succeeded.
            # Restore the captured original name only while our exact candidate
            # still owns the target. Changed or unrelated target names stay put.
            try:
                if cache.inode_at(directory, path.name) == candidate_inode:
                    cache.exchange_file(staged, directory, path.name)
            except (OSError, cache.CacheError):
                # Both names are retained; the same operation classifies their
                # actual bytes before any later mutation.
                pass
            raise
        # Publication and both identities are now verified. A post-unlink sync
        # error cannot require an already-discarded original to be swapped back.
        released += cache.remove_verified(staged, {"sha256": _hash(physical), "size": len(physical)})[
            "last_link_allocated_bytes_unlinked"]
    finally:
        os.close(directory)
    return {"path": str(path), "state": "compacted", "action": "original_bytes_compacted",
            "original_bytes": len(original), "original_sha256": logical_sha,
            "stored_bytes": len(encoded), "last_link_allocated_bytes_unlinked": released,
            "new_metadata_allocated_bytes": created}


def compact(plan_path, *, cache, files=None, work_dir=None, runtime_consumers_root=None):
    """Compact a completed original operation under its root and plan writer locks."""
    source_plan_path = Path(plan_path).absolute()
    retained_path, plan, consumers = cache.resolved_plan(source_plan_path, runtime_consumers_root)
    plan_path = Path(retained_path).absolute()
    selected = [plan_path, cache.state_path(plan_path)]
    if source_plan_path != plan_path and os.path.lexists(source_plan_path):
        selected.append(source_plan_path)
    allowed_parents = {source_plan_path.parent, plan_path.parent}
    for value in files or []:
        path = Path(value).absolute()
        if path.parent not in allowed_parents:
            raise ValueError("Additional metadata must be beside the original or retained plan")
        if path not in selected:
            selected.append(path)
    if len(selected) > MAX_FILES:
        raise ValueError("Select at most 32 exact metadata files in one original operation")
    before = cache.disk_space(plan_path.parent)
    results = []
    with cache.workspace(plan, work_dir) as work_stage, consumers.metadata_journal(plan_path, plan):
        if cache.load_plan(plan_path) != plan:
            raise ValueError("The original plan changed before ownership was acquired")
        if os.path.lexists(cache.progress_path(plan_path)):
            raise ValueError("Finish the original progress checkpoint before compacting metadata")
        state = cache.load_state(plan_path, plan)
        sharing = plan.get("strategy", "retire") == "coalesce"
        required = "coalesced" if sharing else "retired"
        if not plan["entries"]:
            raise ValueError("Select a completed original custody operation")
        for entry in plan["entries"]:
            saved = state["items"].get(entry["id"], {})
            staged = Path(saved.get("staged_path") or (
                work_stage / (entry["id"] + (".shared" if sharing else ".data"))))
            if staged.parent != work_stage:
                raise ValueError("Use this completed operation's original work directory")
            if (saved.get("state") != required or saved.get("phase") != "complete"
                    or os.path.lexists(staged)):
                raise ValueError("Only a completely finished original custody operation can be compacted")
        prepared, selected_bytes = [], 0
        for path in selected:
            physical, observed = _read_regular(path)
            original = decode_metadata(physical)
            selected_bytes += len(original)
            if selected_bytes > MAX_SELECTED_BYTES:
                raise ValueError("Selected metadata exceeds 256 MiB; select fewer explicit reports")
            kind = _member_kind(path, original, plan, plan_path, cache, source_plan_path=source_plan_path)
            prepared.append((path, _hash(original), observed, kind))
        for path, expected_sha, observed, kind in prepared:
            physical, current = _read_regular(path)
            original = decode_metadata(physical)
            if _stamp(current) != _stamp(observed) or _hash(original) != expected_sha:
                raise ValueError("Selected metadata changed after original preflight")
            value = _compact_one(path, original, physical, observed, cache)
            results.append({**value, "kind": kind})
        # Consume the same original APIs after publication, without recopying any
        # source or target. All logical plan and progress values must be identical.
        if cache.load_plan(plan_path) != plan or cache.load_state(plan_path, plan) != state:
            raise ValueError("Original cache identity changed after metadata compaction")
    released = sum(item["last_link_allocated_bytes_unlinked"] for item in results)
    created = sum(item["new_metadata_allocated_bytes"] for item in results)
    return {"ok": True, "plan_id": plan["plan_id"], "operation_id": plan.get("operation_id"),
            "requested_plan": str(source_plan_path), "retained_plan": str(plan_path),
            "runtime_consumers_root": str(consumers.root), "metadata_format": SCHEMA, "entries": results,
            "last_link_allocated_bytes_unlinked": released,
            "new_metadata_allocated_bytes": created,
            "known_metadata_allocation_reduction": released - created,
            "disk_before": before, "disk_after": cache.disk_space(plan_path.parent),
            "targets_changed": 0, "custody_files_changed": 0}


def expand(path, destination, *, cache):
    """Recover the original raw JSON, create-only, without changing compact state."""
    path, destination = Path(path).absolute(), Path(destination).absolute()
    original = read_metadata_bytes(path)
    if path == destination:
        raise ValueError("Choose a separate destination for original metadata bytes")
    try:
        present, _ = _read_regular(destination)
    except FileNotFoundError:
        cache.atomic_bytes(destination, original, new=True)
        action = "materialized"
    else:
        if present != original:
            raise ValueError("Existing metadata destination differs; it is preserved")
        action = "already_present"
    restored, _ = _read_regular(destination)
    if restored != original:
        raise ValueError("Recovered metadata bytes changed")
    return {"ok": True, "path": str(path), "destination": str(destination),
            "bytes": len(original), "sha256": _hash(original), "action": action}
