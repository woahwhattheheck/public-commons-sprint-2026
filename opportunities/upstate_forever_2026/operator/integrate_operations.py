#!/usr/bin/env python3
"""Apply a complete operator source bundle with exact guards and restart recovery.

Python 3.9+, standard library only. See INTEGRATE_OPERATIONS.md for the schema.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import sys

BUNDLE_SCHEMA = "upstate.operator-integration/v1"
JOURNAL_SCHEMA = "upstate.operator-integration-journal/v1"
CONTROL = ".operator-integration"
UNGUARDED = object()
HASH = re.compile(r"[0-9a-f]{64}\Z")
OPERATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")


class IntegrationError(Exception):
    def __init__(self, message, *, exit_code=2, details=None):
        super().__init__(message)
        self.exit_code = exit_code
        self.details = details or {}


def conflict(message, **details):
    return IntegrationError(message, exit_code=3, details=details)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def decode_json(data, label):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise IntegrationError("Duplicate JSON key", details={"input": label, "key": key})
            result[key] = value
        return result

    def invalid_number(value):
        raise IntegrationError("Non-finite JSON number", details={"input": label, "value": value})

    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs,
                          parse_constant=invalid_number)
    except (UnicodeError, ValueError) as exc:
        raise IntegrationError("Invalid UTF-8 JSON", details={"input": label, "error": str(exc)}) from exc


def text_bytes(value, label):
    if not isinstance(value, str):
        raise IntegrationError("Expected a text value", details={"input": label})
    try:
        return value.encode("utf-8")
    except UnicodeError as exc:
        raise IntegrationError("Text contains an invalid Unicode surrogate",
                               details={"input": label}) from exc


def checked_hash(value, label):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise IntegrationError("Expected a lowercase SHA-256 digest", details={"input": label})
    return value


def relative_path(value):
    if not isinstance(value, str) or not value:
        raise IntegrationError("Application paths must be nonempty strings")
    path = PurePosixPath(value)
    parts = value.split("/")
    invalid = (
        path.is_absolute() or str(path) != value or "\\" in value or ":" in value
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
        or any(part in ("", ".", "..") or part.rstrip(" .") != part for part in parts)
        or parts[0].casefold() == CONTROL.casefold()
    )
    reserved = re.compile(r"(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?\Z", re.I)
    if invalid or any(reserved.fullmatch(part) for part in parts):
        raise IntegrationError("Path must be an exact, confined POSIX relative path",
                               details={"path": value})
    return value


@dataclass(frozen=True)
class Snapshot:
    data: bytes
    mode: int

    def metadata(self):
        return {"exists": True, "sha256": sha256(self.data), "bytes": len(self.data),
                "mode": self.mode}


def metadata(snapshot):
    return snapshot.metadata() if snapshot is not None else {"exists": False}


def same_snapshot(left, right):
    if left is None or right is None:
        return left is right
    return left.data == right.data and left.mode == right.mode


def matches_data(snapshot, record):
    if not record["exists"]:
        return snapshot is None
    return (snapshot is not None and len(snapshot.data) == record["bytes"]
            and sha256(snapshot.data) == record["sha256"])


class ApplicationFiles:
    """Confine reads and replacements to an explicit application directory.

    POSIX directory descriptors keep parent traversal anchored beneath the root.
    Other platforms check every component and use same-directory replacement.
    """

    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise IntegrationError("--application must identify an existing directory")
        self.posix = os.name == "posix" and hasattr(os, "O_NOFOLLOW")
        self.root_fd = None
        if self.posix:
            self.root_fd = os.open(str(self.root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def close(self):
        if self.root_fd is not None:
            os.close(self.root_fd)
            self.root_fd = None

    @staticmethod
    def sync_directory(fd):
        if fd is None:
            return
        try:
            os.fsync(fd)
        except OSError as exc:
            if exc.errno not in (errno.EINVAL, getattr(errno, "ENOTSUP", errno.EINVAL)):
                raise

    @contextmanager
    def parent(self, relative, create=False):
        parts = relative.split("/")
        if self.posix:
            fd = os.dup(self.root_fd)
            try:
                for part in parts[:-1]:
                    try:
                        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=fd)
                    except FileNotFoundError:
                        if not create:
                            raise
                        try:
                            os.mkdir(part, 0o755, dir_fd=fd)
                            self.sync_directory(fd)
                        except FileExistsError:
                            pass
                        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=fd)
                    os.close(fd)
                    fd = child
                yield fd, parts[-1], None
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise conflict("Application path contains a symlink or non-directory",
                                   path=relative) from exc
                raise
            finally:
                os.close(fd)
        else:
            current = self.root
            for part in parts[:-1]:
                current = current / part
                try:
                    mode = current.lstat().st_mode
                except FileNotFoundError:
                    if not create:
                        raise
                    try:
                        current.mkdir()
                    except FileExistsError:
                        pass
                    mode = current.lstat().st_mode
                if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
                    raise conflict("Application path contains a symlink or non-directory",
                                   path=relative)
            yield None, parts[-1], current

    @staticmethod
    def read_at(fd, name, directory, label):
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            if fd is None:
                target = directory / name
                observed = target.lstat()
                if stat.S_ISLNK(observed.st_mode):
                    raise conflict("Application target is a symlink", path=label)
                handle = os.open(str(target), flags)
            else:
                observed = None
                handle = os.open(name, flags, dir_fd=fd)
        except FileNotFoundError:
            return None
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.EISDIR):
                raise conflict("Application target is not a regular file", path=label) from exc
            raise
        try:
            before = os.fstat(handle)
            if not stat.S_ISREG(before.st_mode):
                raise conflict("Application target is not a regular file", path=label)
            if observed is not None and (observed.st_dev, observed.st_ino) != (before.st_dev, before.st_ino):
                raise conflict("Application target changed while opening", path=label)
            chunks = []
            while True:
                chunk = os.read(handle, 1024 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
            after = os.fstat(handle)
            signature = lambda item: (item.st_dev, item.st_ino, item.st_size,
                                      item.st_mtime_ns, item.st_ctime_ns)
            if signature(before) != signature(after):
                raise conflict("Application file changed while reading", path=label)
            return Snapshot(b"".join(chunks), stat.S_IMODE(after.st_mode))
        finally:
            os.close(handle)

    def read(self, relative):
        try:
            with self.parent(relative) as (fd, name, directory):
                return self.read_at(fd, name, directory, relative)
        except FileNotFoundError:
            return None

    def atomic_write(self, relative, data, mode=0o644, expected=UNGUARDED):
        with self.parent(relative, create=True) as (fd, name, directory):
            temporary = ".integration-" + secrets.token_hex(12) + ".tmp"
            target_path = directory / name if fd is None else None
            temporary_path = directory / temporary if fd is None else None
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            handle = (os.open(str(temporary_path), flags, 0o600) if fd is None
                      else os.open(temporary, flags, 0o600, dir_fd=fd))
            try:
                try:
                    with os.fdopen(handle, "wb") as stream:
                        stream.write(data)
                        stream.flush()
                        if hasattr(os, "fchmod"):
                            os.fchmod(stream.fileno(), mode)
                        os.fsync(stream.fileno())
                except BaseException:
                    handle = None
                    raise
                handle = None
                if fd is None and not hasattr(os, "fchmod"):
                    os.chmod(temporary_path, mode)
                current = self.read_at(fd, name, directory, relative)
                if expected is not UNGUARDED and not same_snapshot(current, expected):
                    raise conflict("Application file changed before replacement", path=relative)
                if expected is None:
                    # Linking a complete temporary file creates without clobbering a raced writer.
                    try:
                        if fd is None:
                            os.link(temporary_path, target_path)
                        else:
                            os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd,
                                    follow_symlinks=False)
                    except FileExistsError as exc:
                        raise conflict("A new application file appeared during creation",
                                       path=relative) from exc
                elif fd is None:
                    os.replace(temporary_path, target_path)
                else:
                    os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
                self.sync_directory(fd)
            finally:
                if handle is not None:
                    os.close(handle)
                try:
                    if fd is None:
                        temporary_path.unlink()
                    else:
                        os.unlink(temporary, dir_fd=fd)
                except FileNotFoundError:
                    pass

    @contextmanager
    def receiver_lock(self):
        relative = CONTROL + "/receiver.lock"
        with self.parent(relative, create=True) as (fd, name, directory):
            flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
            if fd is None:
                target = directory / name
                if target.is_symlink():
                    raise conflict("Receiver lock is a symlink", path=relative)
                handle = os.open(str(target), flags, 0o600)
            else:
                handle = os.open(name, flags, 0o600, dir_fd=fd)
            try:
                if not stat.S_ISREG(os.fstat(handle).st_mode):
                    raise conflict("Receiver lock is not a regular file", path=relative)
                try:
                    if os.name == "posix":
                        import fcntl
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    elif os.name == "nt":
                        import msvcrt
                        if os.fstat(handle).st_size == 0:
                            os.write(handle, b"\0")
                            os.fsync(handle)
                        os.lseek(handle, 0, os.SEEK_SET)
                        msvcrt.locking(handle, msvcrt.LK_NBLCK, 1)
                    else:
                        raise IntegrationError("Receiver locking is unavailable on this platform")
                except OSError as exc:
                    raise conflict("Another integration receiver is running",
                                   lock=str(self.root / relative)) from exc
                yield
            finally:
                os.close(handle)


def load_bundle(path):
    raw = decode_json(Path(path).read_bytes(), str(path))
    if not isinstance(raw, dict) or raw.get("schema") != BUNDLE_SCHEMA:
        raise IntegrationError("Unsupported source bundle schema")
    operation_id = raw.get("operation_id")
    if not isinstance(operation_id, str) or not OPERATION.fullmatch(operation_id):
        raise IntegrationError("operation_id must contain 1-120 safe letters, digits, dots, underscores or hyphens")
    relative_path(operation_id)
    allowed = raw.get("allowed_paths")
    if not isinstance(allowed, list) or not allowed:
        raise IntegrationError("allowed_paths must explicitly list every permitted application path")
    allowed = [relative_path(item) for item in allowed]
    if len(set(allowed)) != len(allowed):
        raise IntegrationError("allowed_paths contains duplicates")
    folded = [os.path.normcase(item) for item in allowed]
    if len(set(folded)) != len(folded):
        raise IntegrationError("allowed_paths contains aliases on this filesystem")
    allowed = set(allowed)
    entries = raw.get("files", {})
    edits = raw.get("edits", [])
    if not isinstance(entries, dict) or not isinstance(edits, list):
        raise IntegrationError("files must be an object and edits must be an array")
    files = {}
    by_path = {}
    for path, entry in entries.items():
        path = relative_path(path)
        if path not in allowed or not isinstance(entry, dict):
            raise IntegrationError("File is absent from allowed_paths or has an invalid entry",
                                   details={"path": path})
        payload = text_bytes(entry.get("content"), "files." + path + ".content")
        size = entry.get("bytes")
        digest = checked_hash(entry.get("sha256"), "files." + path + ".sha256")
        if type(size) is not int or size != len(payload) or sha256(payload) != digest:
            raise IntegrationError("Source file length or SHA-256 mismatch", details={"path": path})
        previous = entry.get("expected_previous_sha256")
        if previous is not None:
            checked_hash(previous, "files." + path + ".expected_previous_sha256")
        files[path] = {"data": payload, "expected_previous_sha256": previous}
    edit_ids = set()
    for entry in edits:
        if not isinstance(entry, dict):
            raise IntegrationError("Each edit must be an object")
        path = relative_path(entry.get("path"))
        edit_id = entry.get("id")
        if path not in allowed:
            raise IntegrationError("Edit path is absent from allowed_paths", details={"path": path})
        if not isinstance(edit_id, str) or not edit_id or edit_id in edit_ids:
            raise IntegrationError("Every edit needs a unique nonempty id", details={"path": path})
        edit_ids.add(edit_id)
        before = entry.get("before")
        after = entry.get("after")
        text_bytes(before, "edits." + edit_id + ".before")
        text_bytes(after, "edits." + edit_id + ".after")
        if not before:
            raise IntegrationError("Edit before text must be nonempty", details={"edit": edit_id})
        by_path.setdefault(path, []).append({"id": edit_id, "before": before, "after": after})
    paths = sorted(set(files) | set(by_path))
    if not paths:
        raise IntegrationError("Bundle contains no application files or edits")
    path_set = {os.path.normcase(path) for path in paths}
    for path in paths:
        if any(os.path.normcase(str(parent)) in path_set for parent in PurePosixPath(path).parents):
            raise IntegrationError("A file target is also another target's parent", details={"path": path})
    try:
        bundle_digest = sha256(canonical_json(raw))
    except (ValueError, UnicodeError) as exc:
        raise IntegrationError("Bundle metadata cannot be encoded as canonical UTF-8 JSON") from exc
    return {"raw": raw, "operation_id": operation_id, "sha256": bundle_digest,
            "files": files, "edits": by_path, "paths": paths, "allowed": allowed}


def occurrences(text, needle):
    positions = []
    start = 0
    while True:
        found = text.find(needle, start)
        if found < 0:
            return positions
        positions.append(found)
        if len(positions) > 1:
            return positions
        start = found + 1


def apply_edits(path, payload, edits):
    try:
        text = payload.decode("utf-8")
    except UnicodeError as exc:
        raise IntegrationError("Edited application file is not UTF-8", details={"path": path}) from exc
    outcomes = []
    for edit in edits:
        before, after = edit["before"], edit["after"]
        old = occurrences(text, before)
        new = occurrences(text, after) if after else []
        if before == after:
            if len(old) != 1:
                raise conflict("Unchanged edit anchor is missing or ambiguous", path=path, edit=edit["id"])
            outcomes.append({"id": edit["id"], "status": "already_applied"})
            continue
        if len(new) == 1:
            start, end = new[0], new[0] + len(after)
            first_old = text.find(before)
            outside = ((first_old >= 0 and first_old < start)
                       or text.find(before, max(start, end - len(before) + 1)) >= 0)
            if not outside:
                outcomes.append({"id": edit["id"], "status": "already_applied"})
                continue
        contained_after = (len(old) == 1 and len(new) == 1
                           and old[0] <= new[0]
                           and new[0] + len(after) <= old[0] + len(before))
        if len(old) == 1 and (not new or contained_after):
            index = old[0]
            text = text[:index] + after + text[index + len(before):]
            outcomes.append({"id": edit["id"], "status": "applied"})
            continue
        raise conflict("Edit needs one unique before anchor or one unique complete after anchor",
                       path=path, edit=edit["id"], before_matches=len(old),
                       after_matches=len(new), counts_capped_at=2)
    return text.encode("utf-8"), outcomes


def compose_one(bundle, path, current):
    file_entry = bundle["files"].get(path)
    edits = bundle["edits"].get(path, [])
    if file_entry is not None:
        payload, outcomes = apply_edits(path, file_entry["data"], edits)
        if current is not None and current.data not in (payload, file_entry["data"]):
            expected = file_entry["expected_previous_sha256"]
            if expected is None or sha256(current.data) != expected:
                raise conflict("Existing full file differs; expected_previous_sha256 is required",
                               path=path, current_sha256=sha256(current.data),
                               expected_previous_sha256=expected, intended_sha256=sha256(payload))
    else:
        if current is None:
            raise conflict("Cannot edit an application file that does not exist", path=path)
        payload, outcomes = apply_edits(path, current.data, edits)
    return Snapshot(payload, current.mode if current is not None else 0o644), outcomes


def compose_all(filesystem, bundle):
    snapshots = {path: filesystem.read(path) for path in bundle["paths"]}
    plans = []
    errors = []
    for path in bundle["paths"]:
        try:
            after, outcomes = compose_one(bundle, path, snapshots[path])
            plans.append({"path": path, "before": snapshots[path], "after": after, "edits": outcomes})
        except IntegrationError as exc:
            errors.append({"path": path, "message": str(exc), **exc.details})
    if errors:
        raise conflict("Bundle cannot be composed against the current application", conflicts=errors)
    return plans


def operation_path(bundle, suffix):
    return CONTROL + "/" + bundle["operation_id"] + "/" + suffix


def check_binding(value, bundle, filesystem, label):
    if not isinstance(value, dict):
        raise IntegrationError("Invalid operation record", details={"input": label})
    expected = {"operation_id": bundle["operation_id"], "bundle_sha256": bundle["sha256"],
                "application": str(filesystem.root)}
    differing = {key: {"recorded": value.get(key), "requested": item}
                 for key, item in expected.items() if value.get(key) != item}
    if differing:
        raise conflict("Operation id is already bound to a different bundle or application",
                       record=label, differences=differing)


def write_record(filesystem, path, value):
    filesystem.atomic_write(path, canonical_json(value) + b"\n", mode=0o600)


def save_journal(filesystem, bundle, journal):
    journal["updated_at"] = utc_now()
    write_record(filesystem, operation_path(bundle, "journal.json"), journal)


def validate_metadata(record, label):
    if not isinstance(record, dict) or type(record.get("exists")) is not bool:
        raise IntegrationError("Invalid file metadata in operation journal", details={"input": label})
    if not record["exists"]:
        return
    checked_hash(record.get("sha256"), label + ".sha256")
    if type(record.get("bytes")) is not int or record["bytes"] < 0:
        raise IntegrationError("Invalid byte length in operation journal", details={"input": label})
    if type(record.get("mode")) is not int or not 0 <= record["mode"] <= 0o7777:
        raise IntegrationError("Invalid file mode in operation journal", details={"input": label})


def read_object(filesystem, bundle, record):
    if not record["exists"]:
        return None
    relative = operation_path(bundle, "objects/" + record["sha256"])
    stored = filesystem.read(relative)
    if stored is None or not matches_data(stored, record):
        raise IntegrationError("Retained operation object is missing or has changed",
                               details={"object": relative, "sha256": record["sha256"]})
    return Snapshot(stored.data, record["mode"])


def stage_object(filesystem, bundle, snapshot):
    if snapshot is None:
        return
    relative = operation_path(bundle, "objects/" + sha256(snapshot.data))
    existing = filesystem.read(relative)
    if existing is None:
        filesystem.atomic_write(relative, snapshot.data, mode=0o600, expected=None)
    elif existing.data != snapshot.data:
        raise conflict("Retained operation object differs from its digest", object=relative)


def read_history(filesystem, bundle):
    intent_path = operation_path(bundle, "intent.json")
    intent = filesystem.read(intent_path)
    if intent is not None:
        value = decode_json(intent.data, intent_path)
        if not isinstance(value, dict) or value.get("schema") != "upstate.operator-integration-intent/v1":
            raise IntegrationError("Unsupported operation intent schema")
        check_binding(value, bundle, filesystem, intent_path)
    journal_path = operation_path(bundle, "journal.json")
    current = filesystem.read(journal_path)
    if current is None:
        return None, None
    journal = decode_json(current.data, journal_path)
    check_binding(journal, bundle, filesystem, journal_path)
    if journal.get("schema") != JOURNAL_SCHEMA:
        raise IntegrationError("Unsupported operation journal schema")
    if journal.get("state") not in ("prepared", "applying", "conflict", "complete"):
        raise IntegrationError("Invalid operation journal state")
    records = journal.get("files")
    if not isinstance(records, list) or len(records) != len(bundle["paths"]):
        raise IntegrationError("Journal paths do not match the source bundle")
    if any(not isinstance(item, dict) for item in records):
        raise IntegrationError("Invalid file entry in operation journal")
    journal_paths = [relative_path(item.get("path")) for item in records]
    if sorted(journal_paths) != bundle["paths"]:
        raise IntegrationError("Journal paths do not match the source bundle")
    plans = []
    for record in records:
        path = record["path"]
        validate_metadata(record.get("before"), path + ".before")
        validate_metadata(record.get("after"), path + ".after")
        if not record["after"]["exists"]:
            raise IntegrationError("This receiver does not accept file deletion records")
        before = read_object(filesystem, bundle, record["before"])
        after = read_object(filesystem, bundle, record["after"])
        expected, outcomes = compose_one(bundle, path, before)
        if after.data != expected.data:
            raise IntegrationError("Journal postimage does not match the requested bundle",
                                   details={"path": path})
        plans.append({"path": path, "before": before, "after": after, "edits": outcomes})
    return journal, plans


def prepare_journal(filesystem, bundle, plans):
    intent_path = operation_path(bundle, "intent.json")
    if filesystem.read(intent_path) is None:
        intent = {"schema": "upstate.operator-integration-intent/v1",
                  "operation_id": bundle["operation_id"], "bundle_sha256": bundle["sha256"],
                  "application": str(filesystem.root), "created_at": utc_now()}
        filesystem.atomic_write(intent_path, canonical_json(intent) + b"\n",
                                mode=0o600, expected=None)
    # No application target is replaced until every before/after object is durable.
    for plan in plans:
        stage_object(filesystem, bundle, plan["before"])
        stage_object(filesystem, bundle, plan["after"])
    records = [{"path": plan["path"], "before": metadata(plan["before"]),
                "after": metadata(plan["after"]), "edits": plan["edits"], "applied": False}
               for plan in plans]
    journal = {"schema": JOURNAL_SCHEMA, "operation_id": bundle["operation_id"],
               "bundle_sha256": bundle["sha256"], "application": str(filesystem.root),
               "created_at": utc_now(), "state": "prepared", "files": records}
    save_journal(filesystem, bundle, journal)
    return journal


def inspect_current(filesystem, plans, completed=False):
    statuses = []
    conflicts = []
    for plan in plans:
        path = plan["path"]
        current = filesystem.read(path)
        if matches_data(current, metadata(plan["after"])):
            status = "already_applied"
        elif completed:
            status = "modified_since_completion"
        elif matches_data(current, metadata(plan["before"])):
            status = "pending"
        else:
            status = "conflict"
        row = {"path": path, "status": status, "current_sha256": sha256(current.data) if current else None,
               "before_sha256": sha256(plan["before"].data) if plan["before"] else None,
               "after_sha256": sha256(plan["after"].data), "bytes": len(plan["after"].data),
               "edits": plan["edits"]}
        statuses.append(row)
        if status in ("conflict", "modified_since_completion"):
            conflicts.append(row)
    return statuses, conflicts


def report(filesystem, bundle, statuses, *, state, dry_run, resumed=False):
    counts = {}
    for item in statuses:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return {"schema": "upstate.operator-integration-result/v1",
            "operation_id": bundle["operation_id"], "bundle_sha256": bundle["sha256"],
            "application": str(filesystem.root), "state": state, "dry_run": dry_run,
            "resumed": resumed, "counts": counts, "files": statuses,
            "journal": str(filesystem.root / operation_path(bundle, "journal.json"))}


def apply_prepared(filesystem, bundle, journal, plans):
    statuses, conflicts = inspect_current(filesystem, plans, journal["state"] == "complete")
    if conflicts:
        if journal["state"] != "complete":
            journal["state"] = "conflict"
            journal["conflicts"] = conflicts
            save_journal(filesystem, bundle, journal)
        state = "complete_with_later_changes" if journal["state"] == "complete" else "conflict"
        raise conflict("Live source differs from the retained operation; existing files were preserved",
                       result=report(filesystem, bundle, statuses, state=state,
                                     dry_run=False, resumed=True))
    if journal["state"] == "complete":
        return report(filesystem, bundle, statuses, state="complete", dry_run=False, resumed=True)
    journal["state"] = "applying"
    journal.pop("conflicts", None)
    save_journal(filesystem, bundle, journal)
    by_path = {record["path"]: record for record in journal["files"]}
    installed = []
    try:
        for plan in plans:
            path = plan["path"]
            current = filesystem.read(path)
            record = by_path[path]
            if matches_data(current, record["after"]):
                record["applied"] = True
                record["outcome"] = "already_applied"
            elif matches_data(current, record["before"]):
                # Keep a concurrent permission-only change while applying guarded source bytes.
                mode = current.mode if current is not None else plan["after"].mode
                filesystem.atomic_write(path, plan["after"].data, mode=mode, expected=current)
                record["applied"] = True
                record["outcome"] = "installed"
                installed.append(path)
            else:
                raise conflict("Application source changed during integration", path=path,
                               current_sha256=sha256(current.data) if current else None)
            save_journal(filesystem, bundle, journal)
    except IntegrationError as exc:
        journal["state"] = "conflict"
        journal["conflicts"] = [{"message": str(exc), **exc.details}]
        save_journal(filesystem, bundle, journal)
        raise
    # One final complete-path observation catches a writer that edited an earlier path.
    statuses, conflicts = inspect_current(filesystem, plans)
    if conflicts or any(item["status"] == "pending" for item in statuses):
        journal["state"] = "conflict"
        journal["conflicts"] = conflicts or [item for item in statuses if item["status"] == "pending"]
        save_journal(filesystem, bundle, journal)
        raise conflict("Application changed before integration completed",
                       result=report(filesystem, bundle, statuses, state="conflict", dry_run=False))
    journal["state"] = "complete"
    journal["completed_at"] = utc_now()
    save_journal(filesystem, bundle, journal)
    installed = set(installed)
    for item in statuses:
        if item["path"] in installed:
            item["status"] = "installed"
    return report(filesystem, bundle, statuses, state="complete", dry_run=False)


def integrate(filesystem, bundle, dry_run):
    if dry_run:
        journal, plans = read_history(filesystem, bundle)
        if plans is None:
            plans = compose_all(filesystem, bundle)
        completed = journal is not None and journal["state"] == "complete"
        statuses, conflicts = inspect_current(filesystem, plans, completed)
        state = ("complete_with_later_changes" if completed and conflicts else
                 "conflict" if conflicts else "complete" if completed else "ready")
        result = report(filesystem, bundle, statuses, state=state, dry_run=True,
                        resumed=journal is not None)
        if conflicts:
            raise conflict("Dry run found source differences", result=result)
        return result
    with filesystem.receiver_lock():
        journal, plans = read_history(filesystem, bundle)
        resumed = journal is not None
        if plans is None:
            plans = compose_all(filesystem, bundle)
            # All source reads and compositions succeeded before staging application mutations.
            statuses, conflicts = inspect_current(filesystem, plans)
            if conflicts:
                raise conflict("Application changed while composing the bundle",
                               result=report(filesystem, bundle, statuses, state="conflict", dry_run=False))
            journal = prepare_journal(filesystem, bundle, plans)
        result = apply_prepared(filesystem, bundle, journal, plans)
        result["resumed"] = resumed
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", help="Path to the explicit UTF-8 JSON source bundle")
    parser.add_argument("--application", required=True,
                        help="Existing application directory containing operator/ and model/")
    parser.add_argument("--dry-run", action="store_true",
                        help="Validate and compose or inspect recovery without writing anything")
    arguments = parser.parse_args(argv)
    filesystem = None
    try:
        bundle = load_bundle(arguments.bundle)
        filesystem = ApplicationFiles(arguments.application)
        result = integrate(filesystem, bundle, arguments.dry_run)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except IntegrationError as exc:
        result = exc.details.get("result", {"schema": "upstate.operator-integration-result/v1",
                                           "state": "conflict" if exc.exit_code == 3 else "error",
                                           "error": str(exc), **exc.details})
        result.setdefault("error", str(exc))
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return exc.exit_code
    except (OSError, ValueError) as exc:
        print(json.dumps({"schema": "upstate.operator-integration-result/v1", "state": "error",
                          "error": str(exc)}, indent=2))
        return 1
    except KeyboardInterrupt:
        print(json.dumps({"schema": "upstate.operator-integration-result/v1",
                          "state": "interrupted",
                          "message": "Rerun the same bundle and operation id to reconcile the journal."}))
        return 130
    finally:
        if filesystem is not None:
            filesystem.close()


if __name__ == "__main__":
    sys.exit(main())
