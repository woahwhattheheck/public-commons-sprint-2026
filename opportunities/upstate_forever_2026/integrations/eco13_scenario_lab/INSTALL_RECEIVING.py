#!/usr/bin/env python3
"""Install a complete ECO13 source bank into its original receiving root.

For an application-relative bank containing operator/, integrations/ and receiving/:
    python INSTALL_RECEIVING.py source-bank.json /path/to/upstate_forever_2026

For a package-relative bank containing eco_scenario_lab/ and its package guides:
    python INSTALL_RECEIVING.py package-bank.json /path/to/upstate_forever_2026/integrations/eco13_scenario_lab

Use the installation target recorded in the selected source bank. The source may
also be a Slack canvas Markdown export containing a JSON fence. Only incoming
Python is compiled; imports, native models, and tests are not run.
"""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile

SCHEMA = "commons.source-bank/v1"


class InstallError(ValueError):
    pass


class InstallerBusy(InstallError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def valid_hash(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def relative_name(value) -> str:
    if not isinstance(value, str) or not value or "\\" in value or any(ord(c) < 32 for c in value):
        raise InstallError("Source file paths must be portable relative names")
    path = PurePosixPath(value)
    if (path.is_absolute() or ".." in path.parts or not path.parts
            or path.as_posix() != value or ":" in path.parts[0]):
        raise InstallError("Invalid package-relative source path: " + value)
    return value


def normalize_json_spacing(text: str) -> str:
    """Repair Canvas indentation while preserving every quoted JSON character."""
    output = []
    quoted = False
    escaped = False
    for character in text:
        if quoted:
            output.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        else:
            if character == '"':
                quoted = True
            output.append(" " if character == "\u00a0" else character)
    return "".join(output)


def read_bank(path: Path):
    text = path.read_text(encoding="utf-8-sig").strip()
    candidates = [text]
    candidates.extend(re.findall(r"\x60{3}(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\x60{3}", text))
    banks = []
    for body in candidates:
        body = normalize_json_spacing(body)
        try:
            value = json.loads(body)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("schema") == SCHEMA:
            banks.append((value, body.strip()))
    if len(banks) != 1:
        raise InstallError("Select one commons.source-bank/v1 JSON object or canvas JSON fence")
    bank, body = banks[0]
    if not isinstance(bank.get("files"), list) or not bank["files"]:
        raise InstallError("The source bank must contain complete files")
    entries, names = [], set()
    for item in bank["files"]:
        if not isinstance(item, dict):
            raise InstallError("Each source entry must be an object")
        name = relative_name(item.get("path"))
        if name in names:
            raise InstallError("Duplicate source path: " + name)
        names.add(name)
        wanted, size = item.get("sha256"), item.get("bytes")
        if not valid_hash(wanted) or type(size) is not int or size < 0:
            raise InstallError("Invalid source digest or byte count: " + name)
        content = item.get("content_base64")
        if not isinstance(content, str):
            raise InstallError("Missing complete ASCII base64 source: " + name)
        try:
            data = base64.b64decode(content.encode("ascii"), validate=True)
        except (ValueError, UnicodeError) as exc:
            raise InstallError("Invalid base64 source: " + name) from exc
        if len(data) != size or sha256(data) != wanted:
            raise InstallError("Source bytes differ from their digest: " + name)
        accepted = item.get("accepted_before_sha256", [])
        if not isinstance(accepted, list) or any(not valid_hash(v) for v in accepted):
            raise InstallError("Invalid accepted predecessor hashes: " + name)
        entries.append({"path": name, "data": data, "bytes": size,
                        "sha256": wanted, "accepted": set(accepted)})
    for name in names:
        if any(parent.as_posix() in names for parent in PurePosixPath(name).parents
               if parent.as_posix() != "."):
            raise InstallError("A source file is also another file's parent: " + name)
    return bank, sha256(body.encode("utf-8")), sorted(entries, key=lambda item: item["path"])


def original_directory(value: Path) -> Path:
    absolute = Path(os.path.abspath(value.expanduser()))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise InstallError("The package directory traverses a symlink: " + str(current))
    if not absolute.is_dir():
        raise InstallError("Select the existing ECO13 package directory: " + str(absolute))
    return absolute


def member(root: Path, name: str) -> Path:
    current = root
    parts = PurePosixPath(relative_name(name)).parts
    for index, part in enumerate(parts):
        current = current / part
        if current.is_symlink():
            raise InstallError("Package path traverses a symlink: " + str(current))
        if index < len(parts) - 1 and current.exists() and not current.is_dir():
            raise InstallError("Package path traverses a regular file: " + str(current))
    return current


def observed(root: Path, name: str):
    path = member(root, name)
    try:
        info = path.stat()
    except FileNotFoundError:
        return None, None
    if not stat.S_ISREG(info.st_mode):
        raise InstallError("Package member is not a regular file: " + str(path))
    return file_sha256(path), stat.S_IMODE(info.st_mode) & 0o777


def atomic_bytes(path: Path, data: bytes, mode=0o644, *, before_replace=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".receiving-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        if before_replace is not None:
            before_replace()
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def require_current(target: Path, name: str, expected):
    current, _ = observed(target, name)
    if current != expected:
        raise InstallError("Source changed before atomic replacement: " + name)


def save_json(path: Path, value):
    atomic_bytes(path, json.dumps(value, indent=2, ensure_ascii=False,
                                  allow_nan=False).encode("utf-8") + b"\n")


def stage_candidate(bank, bank_hash, entries, target: Path, candidate_parent: Path):
    parent = original_directory(candidate_parent)
    if parent.is_relative_to(target):
        raise InstallError("Incoming candidates need a directory outside the target package")
    directory = Path(tempfile.mkdtemp(prefix="eco13-incoming-" + bank_hash[:12] + "-", dir=parent))
    try:
        save_json(directory / "SOURCE_BANK.json", bank)
        for entry in entries:
            path = directory / "incoming" / entry["path"]
            atomic_bytes(path, entry["data"])
            if file_sha256(path) != entry["sha256"]:
                raise InstallError("Incoming candidate changed while staging: " + entry["path"])
        save_json(directory / "target.json", {"schema": 1, "target": str(target),
                  "source_bank_sha256": bank_hash, "files": len(entries)})
    except BaseException as exc:
        raise InstallError("Incoming source staging failed; retained files are at " + str(directory)) from exc
    return directory


@contextmanager
def install_lock(target: Path):
    try:
        import fcntl
    except ImportError as exc:
        raise InstallError("The receiving installer requires a POSIX file-lock runtime") from exc
    lock_path = target.parent / ("." + target.name + ".receiving.lock")
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise InstallerBusy("Another installer currently owns " + str(target)) from exc
        yield
    finally:
        os.close(descriptor)


def preflight(target, entries):
    operations, conflicts, compile_errors, compiled = [], [], [], []
    for entry in entries:
        name = entry["path"]
        try:
            before, mode = observed(target, name)
        except (InstallError, OSError) as exc:
            conflicts.append({"path": name, "target_path": str(target / name),
                              "reason": str(exc), "incoming_sha256": entry["sha256"]})
            before, mode = "unavailable", None
        action = ("unchanged" if before == entry["sha256"] else
                  "create" if before is None else "replace")
        if before not in (None, "unavailable", entry["sha256"]) and before not in entry["accepted"]:
            conflicts.append({"path": name, "target_path": str(target / name),
                              "reason": "current_source_differs",
                              "current_sha256": before, "incoming_sha256": entry["sha256"],
                              "accepted_before_sha256": sorted(entry["accepted"])})
        operations.append({"path": name, "before_sha256": before, "after_sha256": entry["sha256"],
                           "action": action, "mode": mode if mode is not None else 0o644})
        if action != "unchanged" and name.endswith(".py"):
            try:
                compile(entry["data"], str(target / name), "exec", dont_inherit=True)
                compiled.append(name)
            except (SyntaxError, ValueError, TypeError) as exc:
                compile_errors.append({"path": name, "error": type(exc).__name__,
                                       "message": str(exc), "line": getattr(exc, "lineno", None),
                                       "offset": getattr(exc, "offset", None)})
    return operations, conflicts, compile_errors, compiled


def make_parents(target: Path, name: str, created: list):
    current = target
    for part in PurePosixPath(name).parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise InstallError("A target parent became a symlink: " + str(current))
        if not current.exists():
            current.mkdir()
            created.append(current)
        elif not current.is_dir():
            raise InstallError("A target parent is not a directory: " + str(current))


def rollback(target, candidate, attempted, created):
    problems = []
    for operation in reversed(attempted):
        name = operation["path"]
        try:
            current, _ = observed(target, name)
            if current == operation["before_sha256"]:
                continue
            if current != operation["after_sha256"]:
                problems.append({"path": name, "reason": "source_changed_during_recovery",
                                 "current_sha256": current,
                                 "prior_sha256": operation["before_sha256"],
                                 "incoming_sha256": operation["after_sha256"]})
                continue
            path = member(target, name)
            if operation["before_sha256"] is None:
                path.unlink()
            else:
                backup = candidate / "backups" / name
                data = backup.read_bytes()
                if sha256(data) != operation["before_sha256"]:
                    raise InstallError("Retained original backup changed: " + name)
                atomic_bytes(path, data, operation["mode"], before_replace=lambda:
                             require_current(target, name, operation["after_sha256"]))
                if file_sha256(path) != operation["before_sha256"]:
                    raise InstallError("The restored file changed: " + name)
        except (InstallError, OSError) as exc:
            problems.append({"path": name, "reason": str(exc)})
    for directory in reversed(created):
        try:
            directory.rmdir()
        except OSError:
            pass  # Preserve any files that another writer placed in the directory.
    return problems


def apply_source(bank, bank_hash, entries, target, candidate_parent):
    operations, conflicts, compile_errors, compiled = preflight(target, entries)
    changed = [operation for operation in operations if operation["action"] != "unchanged"]
    base_result = {"schema": 1, "target": str(target), "source_bank_sha256": bank_hash,
                   "source_revision": bank.get("revision"), "files": len(entries),
                   "compiled_python": compiled,
                   "unchanged": [operation["path"] for operation in operations if operation["action"] == "unchanged"]}
    if not changed and not conflicts and not compile_errors:
        return {**base_result, "status": "already_current", "changed": []}
    candidate = stage_candidate(bank, bank_hash, entries, target, candidate_parent)
    base_result["candidate_directory"] = str(candidate)
    base_result["incoming_directory"] = str(candidate / "incoming")
    save_json(candidate / "install-plan.json", {**base_result, "operations": operations})
    if conflicts or compile_errors:
        result = {**base_result, "status": "reconcile_source",
                  "conflicts": conflicts, "compile_errors": compile_errors, "changed": []}
        save_json(candidate / "install-result.json", result)
        return result
    entry_map = {entry["path"]: entry for entry in entries}
    attempted, created = [], []
    try:
        # Capture every original to be replaced before changing any target file.
        for operation in changed:
            name = operation["path"]
            current, _ = observed(target, name)
            if current != operation["before_sha256"]:
                raise InstallError("Source changed after preflight: " + name)
            if current is not None:
                backup = candidate / "backups" / name
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(member(target, name), backup)
                if file_sha256(backup) != current or observed(target, name)[0] != current:
                    raise InstallError("Source changed while retaining its backup: " + name)
        for operation in changed:
            name = operation["path"]
            if observed(target, name)[0] != operation["before_sha256"]:
                raise InstallError("Source changed before installation: " + name)
            make_parents(target, name, created)
            # Record before replacement, including the interruption boundary.
            attempted.append(operation)
            atomic_bytes(member(target, name), entry_map[name]["data"], operation["mode"],
                         before_replace=lambda: require_current(target, name, operation["before_sha256"]))
            if observed(target, name)[0] != operation["after_sha256"]:
                raise InstallError("Source changed during installation: " + name)
        for operation in operations:
            if observed(target, operation["path"])[0] != operation["after_sha256"]:
                raise InstallError("Final source verification differs: " + operation["path"])
        result = {**base_result, "status": "installed",
                  "changed": [operation["path"] for operation in changed]}
        save_json(candidate / "install-result.json", result)
        return result
    except BaseException as exc:
        recovery = rollback(target, candidate, attempted, created)
        differences = []
        for operation in operations:
            try:
                current, _ = observed(target, operation["path"])
                if current != operation["before_sha256"]:
                    differences.append({"path": operation["path"],
                                        "target_path": str(target / operation["path"]),
                                        "current_sha256": current,
                                        "prior_sha256": operation["before_sha256"],
                                        "incoming_sha256": operation["after_sha256"]})
            except (InstallError, OSError) as inspection_error:
                differences.append({"path": operation["path"], "reason": str(inspection_error)})
        result = {**base_result,
                  "status": "recovery_required" if recovery else "reconcile_source" if differences else "restored",
                  "error": type(exc).__name__, "message": str(exc),
                  "recovery_conflicts": recovery, "target_differences": differences,
                  "changed": [item["path"] for item in differences
                              if item.get("incoming_sha256") is not None and
                              item.get("current_sha256") == item["incoming_sha256"]]}
        try:
            save_json(candidate / "install-result.json", result)
        except OSError as receipt_error:
            result["record_error"] = str(receipt_error)
        return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_bank", type=Path, help="Complete JSON source bank or canvas Markdown export")
    parser.add_argument("package_directory", type=Path, help="Existing application or package root matching the source bank relative paths")
    parser.add_argument("--candidate-parent", type=Path,
                        help="Existing directory outside the package for complete retained incoming source")
    args = parser.parse_args(argv)
    try:
        bank, bank_hash, entries = read_bank(args.source_bank)
        target = original_directory(args.package_directory)
        parent = args.candidate_parent or target.parent
        try:
            with install_lock(target):
                result = apply_source(bank, bank_hash, entries, target, parent)
        except InstallerBusy as exc:
            # Preserve the entire proposed source for an active native composer.
            candidate = stage_candidate(bank, bank_hash, entries, target, parent)
            result = {"schema": 1, "status": "reconcile_source", "target": str(target),
                      "source_bank_sha256": bank_hash, "error": type(exc).__name__,
                      "message": str(exc), "candidate_directory": str(candidate),
                      "incoming_directory": str(candidate / "incoming"), "changed": []}
            save_json(candidate / "install-result.json", result)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0 if result["status"] in {"installed", "already_current"} else 2
    except (InstallError, OSError, ValueError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)},
                         allow_nan=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
