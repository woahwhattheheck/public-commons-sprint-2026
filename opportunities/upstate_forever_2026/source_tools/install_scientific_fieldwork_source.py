#!/usr/bin/env python3
"""Receive the complete scientific-fieldwork source into an owned restored app.

Only absent, identical, or explicitly recorded original files are installed.
Known reviewed successors remain intact. Unrecognized current bytes are retained
and reported before any source mutation. This does not execute scientific models.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile

SCHEMA = "upstate.scientific-fieldwork-source-install/v1"
RECIPE_SCHEMA = "upstate.scientific-fieldwork-source-guards/v1"
SELF_PATH = "source_tools/install_scientific_fieldwork_source.py"
DEFAULT_RECIPE = "integration/scientific-fieldwork-source-guards-20261013.json"


class InstallError(RuntimeError):
    pass


def digest(body):
    return hashlib.sha256(body).hexdigest()


def identity(body):
    return {"bytes": len(body), "sha256": digest(body)}


def same(observed, expected):
    return (observed is not None and observed["bytes"] == expected["bytes"]
            and observed["sha256"] == expected["sha256"])


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise InstallError("Invalid relative source path: " + repr(value))
    path = PurePosixPath(value)
    if (path.is_absolute() or str(path) != value or
            any(part in ("", ".", "..") for part in path.parts)):
        raise InstallError("Unsafe source path: " + repr(value))
    return path


def no_symlinks(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise InstallError("Symbolic link is not an installation path: " + str(item))
    return path


def absolute(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise InstallError("Use an absolute path: " + str(path))
    no_symlinks(path)
    return path.resolve()


def member(root, name):
    path = root.joinpath(*relative(name).parts)
    no_symlinks(path)
    return path


def read_file(path, missing=False):
    no_symlinks(path)
    try:
        info = path.stat()
    except FileNotFoundError:
        if missing:
            return None
        raise InstallError("Missing source file: " + str(path))
    if not stat.S_ISREG(info.st_mode):
        raise InstallError("Expected an ordinary file: " + str(path))
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        body = stream.read()
        closed = os.fstat(stream.fileno())
    if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != (
            closed.st_dev, closed.st_ino, closed.st_size, closed.st_mtime_ns):
        raise InstallError("File changed while reading: " + str(path))
    if (opened.st_size, opened.st_mtime_ns) != (closed.st_size, closed.st_mtime_ns):
        raise InstallError("File changed while reading: " + str(path))
    return body


def observed(path):
    body = read_file(path, missing=True)
    if body is None:
        return None
    return {**identity(body), "mode": stat.S_IMODE(path.stat().st_mode)}


def equivalent(left, right):
    if left is None or right is None:
        return left is right
    return all(left[key] == right[key] for key in ("bytes", "sha256", "mode"))


def atomic(path, body, mode=0o644):
    no_symlinks(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    no_symlinks(path.parent)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + "-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def json_write(path, value):
    atomic(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


@contextmanager
def installation_lock(application):
    try:
        import fcntl
    except ImportError as error:
        raise InstallError("This receiving installer requires POSIX file locks.") from error
    path = member(application, ".scientific-fieldwork-source.lock")
    with path.open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise InstallError("Another source installation owns " + str(application)) from error
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def check_record(record):
    if (not isinstance(record, dict) or
            type(record.get("bytes")) is not int or record["bytes"] < 0 or
            not isinstance(record.get("sha256"), str) or
            len(record["sha256"]) != 64 or
            any(char not in "0123456789abcdef" for char in record["sha256"])):
        raise InstallError("Invalid file identity in source recipe")


def recipe_read(path):
    body = read_file(path)
    recipe = json.loads(body.decode("utf-8"))
    if recipe.get("schema") != RECIPE_SCHEMA:
        raise InstallError("Unsupported scientific-fieldwork source recipe")
    rows = recipe.get("files")
    if not isinstance(rows, list) or not rows or recipe.get("file_count") != len(rows):
        raise InstallError("Source recipe file count is inconsistent")
    seen = set()
    for row in rows:
        name = str(relative(row["path"]))
        if name == SELF_PATH or name in seen:
            raise InstallError("Duplicate or installer self-replacement path: " + name)
        seen.add(name)
        check_record(row)
        for key in ("accepted_preimages", "retained_successors"):
            if not isinstance(row.get(key, []), list):
                raise InstallError("Invalid " + key + " for " + name)
            for item in row.get(key, []):
                check_record(item)
        if name != row["path"]:
            raise InstallError("Noncanonical source path: " + name)
    if sum(row["bytes"] for row in rows) != recipe.get("source_bytes"):
        raise InstallError("Source recipe byte total is inconsistent")
    return recipe, identity(body)


def source_root(path):
    candidates = [path, path / "application"]
    usable = [item for item in candidates if (item / "model" / "implementation.py").is_file()]
    if len(usable) != 1:
        raise InstallError("Source must be the materialized application or its single parent")
    no_symlinks(usable[0])
    return usable[0]


def disjoint(first, second):
    return not (first == second or first in second.parents or second in first.parents)


def assess(application, source, rows):
    decisions, contents = [], {}
    for row in rows:
        name = row["path"]
        incoming = read_file(member(source, name))
        if not same(identity(incoming), row):
            raise InstallError("Incoming bytes do not match the published source recipe: " + name)
        incoming.decode("utf-8")
        if name.endswith(".py"):
            compile(incoming, name, "exec", dont_inherit=True)
        contents[name] = incoming
        current = observed(member(application, name))
        decision = {"path": name, "incoming": {key: row[key] for key in ("bytes", "sha256")},
                    "before": current}
        if current is None:
            decision["action"] = "create"
        elif same(current, row):
            decision["action"] = "unchanged"
        elif any(same(current, item) for item in row.get("retained_successors", [])):
            retained = next(item for item in row["retained_successors"] if same(current, item))
            decision.update(action="retain_successor", reason=retained["reason"])
            if name.endswith(".py"):
                compile(read_file(member(application, name)), name, "exec", dont_inherit=True)
        elif any(same(current, item) for item in row.get("accepted_preimages", [])):
            decision["action"] = "replace_original"
        else:
            decision.update(action="conflict",
                            reason="Unrecognized current source is retained. Compose this exact "
                                   "path with its recorded incoming source before retrying.")
        decisions.append(decision)
    return decisions, contents


def install(application, source, recipe_path, receipts, check_only=False):
    application, source = absolute(application), source_root(absolute(source))
    receipts, recipe_path = absolute(receipts), absolute(recipe_path)
    if not application.is_dir() or not (application / "model" / "implementation.py").is_file():
        raise InstallError("Target must be an existing restored scientific application")
    if not disjoint(application, source):
        raise InstallError("Incoming source and target application must be separate roots")
    if not disjoint(receipts, application) or not disjoint(receipts, source):
        raise InstallError("Receipt and original backup directory must be outside both roots")
    recipe, recipe_identity = recipe_read(recipe_path)
    receipts.mkdir(parents=True, exist_ok=True)
    no_symlinks(receipts)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    run_key = hashlib.sha256((str(application) + "\0" + recipe_identity["sha256"]).encode()).hexdigest()
    run_root = member(receipts, run_key)
    run_root.mkdir(parents=True, exist_ok=True)
    attempts = run_root / "attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    no_symlinks(attempts)
    attempt_root = Path(tempfile.mkdtemp(prefix="receive-", dir=str(attempts)))
    receipt_path = attempt_root / "install.json"
    with installation_lock(application):
        decisions, contents = assess(application, source, recipe["files"])
        receipt = {"schema": SCHEMA, "operation": recipe.get("operation"),
                   "application": str(application), "source": str(source),
                   "recipe_path": str(recipe_path), "recipe": recipe_identity,
                   "original_backup_root": str(run_root),
                   "source_commit": recipe.get("source_commit"),
                   "original_application": recipe.get("original_application"),
                   "owner_direction": recipe.get("owner_direction"),
                   "started_at": started, "check_only": check_only,
                   "state": "checked", "files": decisions}
        conflicts = [item for item in decisions if item["action"] == "conflict"]
        if conflicts:
            receipt["state"] = "source_composition_required"
            json_write(receipt_path, receipt)
            return receipt, receipt_path
        if check_only:
            json_write(receipt_path, receipt)
            return receipt, receipt_path
        # Recheck the complete target under the same lock before the first mutation.
        for item in decisions:
            if not equivalent(observed(member(application, item["path"])), item["before"]):
                raise InstallError("Source changed during preflight: " + item["path"])
        receipt["state"] = "installing"
        json_write(receipt_path, receipt)
        try:
            for item in decisions:
                name, action = item["path"], item["action"]
                target = member(application, name)
                if not equivalent(observed(target), item["before"]):
                    raise InstallError("Source changed before installation: " + name)
                if action in ("create", "replace_original"):
                    current = item["before"]
                    if current is not None:
                        prior = read_file(target)
                        if not same(identity(prior), current):
                            raise InstallError("Source changed before backup: " + name)
                        backup = member(run_root, "originals/" + current["sha256"] + "/" + name)
                        retained = read_file(backup, missing=True)
                        if retained is None:
                            atomic(backup, prior, current["mode"])
                        elif retained != prior:
                            raise InstallError("Original source backup differs: " + name)
                        item["original_backup"] = str(backup.relative_to(run_root))
                    # Atomic replacement never mutates an inode shared with the original.
                    if not equivalent(observed(target), current):
                        raise InstallError("Source changed before replacement: " + name)
                    atomic(target, contents[name], current["mode"] if current else 0o644)
                item["after"] = observed(target)
                expected = item["before"] if action == "retain_successor" else item["incoming"]
                if not same(item["after"], expected):
                    raise InstallError("Installed source readback differs: " + name)
                item["received"] = True
                json_write(receipt_path, receipt)
            # Catch concurrent writes to any earlier member before reporting completion.
            for item in decisions:
                if not equivalent(observed(member(application, item["path"])), item["after"]):
                    raise InstallError("Source changed after installation: " + item["path"])
            receipt["state"] = "installed"
            receipt["completed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            receipt["next_step"] = "Run the original scientific-fieldwork course from this owned application."
            json_write(receipt_path, receipt)
        except Exception as error:
            receipt.update(state="interrupted", error=str(error),
                           recovery="Keep this receipt and originals; rerun the same command. "
                                    "Already installed exact members are accepted without replacement.")
            json_write(receipt_path, receipt)
            raise
    return receipt, receipt_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Absolute owned restored application directory")
    parser.add_argument("--source", required=True, help="Absolute materialized incoming source directory")
    parser.add_argument("--recipe", required=True, help="Absolute exact source-guard recipe JSON")
    parser.add_argument("--receipt-dir", required=True, help="Absolute external receipt/original-backup directory")
    parser.add_argument("--check", action="store_true", help="Report source decisions without installing files")
    args = parser.parse_args(argv)
    try:
        receipt, path = install(args.application, args.source, args.recipe, args.receipt_dir, args.check)
    except (InstallError, OSError, ValueError, SyntaxError) as error:
        parser.exit(2, str(error) + "\n")
    counts = {}
    for item in receipt["files"]:
        counts[item["action"]] = counts.get(item["action"], 0) + 1
    print(json.dumps({"state": receipt["state"], "receipt": str(path), "files": counts,
                      "conflicts": [item for item in receipt["files"] if item["action"] == "conflict"]},
                     ensure_ascii=False, indent=2))
    return 2 if receipt["state"] == "source_composition_required" else 0


if __name__ == "__main__":
    raise SystemExit(main())
