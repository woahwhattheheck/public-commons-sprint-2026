"""Restore a pinned Library container for an original Commons custody plan.

The caller supplies the complete current Library download helpers.  This module
passes the original search result through their documented stdin interface;
it does not implement authentication or a second download transport.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile

REQUEST_SCHEMA = "commons.native-library-custody-request/v1"
RECEIPT_SCHEMA = "commons.native-library-custody-receipt/v1"
STATE_SCHEMA = "commons.native-library-custody-state/v1"
HELPERS = ("library_download.py", "library_hosted_apps.py",
           "library_file_transfer.py")
BLOCK = 1024 * 1024
METADATA_LIMIT = 16 * 1024 * 1024
HEX = re.compile(r"^[0-9a-f]{64}$")


class LibraryCustodyError(ValueError):
    pass


def _require(condition, message):
    if not condition:
        raise LibraryCustodyError(message)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def _digest(value):
    return hashlib.sha256(_encoded(value)).hexdigest()


def _cache():
    if __package__:
        from . import swarm_cloud_cache
    else:
        import swarm_cloud_cache
    return swarm_cloud_cache


def _same_stat(info):
    return (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _file_identity(path):
    """Hash a stable ordinary file without accepting a symlink replacement."""
    path = Path(path).absolute()
    _require(path.resolve(strict=True) == path,
             "Select an ordinary source path without symlink components")
    before = path.lstat()
    _require(stat.S_ISREG(before.st_mode), "Select an ordinary complete file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        initial = os.fstat(descriptor)
        _require(_same_stat(initial) == _same_stat(before),
                 "The selected file changed before it was opened")
        digest, size = hashlib.sha256(), 0
        while block := os.read(descriptor, BLOCK):
            digest.update(block)
            size += len(block)
        after = os.fstat(descriptor)
        _require(_same_stat(initial) == _same_stat(after) ==
                 _same_stat(path.lstat()) and size == initial.st_size,
                 "The selected file changed during its complete read")
        return {"bytes": size, "sha256": digest.hexdigest()}
    finally:
        os.close(descriptor)


def _private_directory(path, *, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, exist_ok=True)
    _require(path.resolve(strict=True) == path and path.is_dir(),
             "Select an ordinary existing private directory")
    info = path.stat()
    _require(info.st_uid == os.geteuid() and
             stat.S_IMODE(info.st_mode) & 0o077 == 0,
             "Keep original Library requests and results in an owned private directory")
    return path


def _placement_path(path):
    _require(isinstance(path, (str, Path)) and str(path),
             "Select an explicit absolute warm materialization directory")
    selected = Path(path).expanduser()
    _require(selected.is_absolute() and ".." not in selected.parts,
             "Warm materialization needs an absolute ordinary path")
    selected = selected.absolute()
    _require(selected.resolve(strict=False) == selected,
             "Keep warm materialization outside symlinked paths")
    return selected


def _placement_option(path, directory, protected_paths=()):
    if path is None:
        return {}
    selected = _placement_path(path)
    if selected.exists() or selected.is_symlink():
        _private_directory(selected)
    else:
        # Cold continuation keeps its saved placement even after a temporary
        # mount closes. A first selection must observe an existing private root.
        request = Path(directory) / "request.json"
        original = Path(directory) / "operation-input.json"
        if request.exists():
            retained = _request(request)[1]
        elif original.exists():
            retained = _read(original)
        else:
            retained = {}
        _require(retained.get("materialization_root") == str(selected),
                 "Create the selected private warm root before first preparation")
    protected = [Path(directory), *(Path(item) for item in protected_paths)]
    for original in protected:
        _require(not _cache().beneath(selected, original)
                 and not _cache().beneath(original, selected),
                 "Keep warm materialization separate from durable controls and selected source")
    return {"materialization_root": str(selected)}


def _materialization_directory(directory, value, *, create=False):
    """Locate replaceable large bytes without requiring a warm volume on reads."""
    if "materialization_root" not in value:
        return directory
    selected = _placement_path(value["materialization_root"])
    if create:
        # This exact operator-selected private root can be recreated after a
        # temporary mount closes. The request and its custody remain durable.
        selected.mkdir(mode=0o700, parents=True, exist_ok=True)
    if selected.exists() or selected.is_symlink():
        _private_directory(selected)
    child = selected / directory.name
    if create or child.exists() or child.is_symlink():
        _private_directory(child, create=create)
    return child


def _incomplete_file(directory, value, number, *, create=False, bootstrap=False):
    _require(type(number) is int and number > 0,
             "Keep the original positive attempt number")
    root = _materialization_directory(directory, value, create=create)
    if bootstrap:
        root = root / "bootstrap"
        if create or root.exists() or root.is_symlink():
            _private_directory(root, create=create)
    parent = root / ("attempt-" + str(number))
    if create or parent.exists() or parent.is_symlink():
        _private_directory(parent, create=create)
    return parent / "incomplete-container"


def _helper_environment(directory, value):
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    if "materialization_root" in value:
        working = _materialization_directory(directory, value, create=True)
        temporary = _private_directory(working / "temporary", create=True)
        environment["TMPDIR"] = str(temporary)
    return environment


def _sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _save(path, value, *, create_only=False):
    path = Path(path)
    content = _encoded(value)
    _require(len(content) <= METADATA_LIMIT,
             "Keep each original metadata record within 16 MiB")
    descriptor, pending = tempfile.mkstemp(prefix=".library-custody-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if create_only:
            try:
                os.link(pending, path, follow_symlinks=False)
            except FileExistsError:
                _require(_read(path) == value,
                         "An existing original record differs; it was preserved")
        else:
            if path.exists() or path.is_symlink():
                _require(stat.S_ISREG(path.lstat().st_mode) and
                         not path.is_symlink(),
                         "Preserve an unexpected metadata path")
            os.replace(pending, path)
        _sync_directory(path.parent)
    finally:
        Path(pending).unlink(missing_ok=True)


def _read(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        _require(stat.S_ISREG(before.st_mode) and before.st_size <= METADATA_LIMIT,
                 "Select an ordinary complete metadata record")
        chunks, size = [], 0
        while block := os.read(descriptor, min(BLOCK, METADATA_LIMIT + 1 - size)):
            chunks.append(block)
            size += len(block)
            _require(size <= METADATA_LIMIT, "Metadata exceeds the original limit")
        _require(_same_stat(before) == _same_stat(os.fstat(descriptor)) ==
                 _same_stat(path.lstat()) and size == before.st_size,
                 "Metadata changed during its read")
        return json.loads(b"".join(chunks))
    finally:
        os.close(descriptor)


@contextmanager
def _lock(directory):
    descriptor = os.open(directory / ".lock",
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                 "Preserve the original ordinary materialization lock")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise LibraryCustodyError(
                "The original materialization or receiving consumer is still active") from exc
        yield descriptor
    finally:
        os.close(descriptor)


def _helper_identity(directory):
    directory = Path(directory).expanduser().resolve(strict=True)
    _require(directory.is_dir(), "Supply the complete current Library helper directory")
    return {name: _file_identity(directory / name) for name in HELPERS}


def _selected(result, selection):
    _require(isinstance(result, dict) and
             isinstance(result.get("results"), list) and
             isinstance(result.get("retrieval_title_results", []), list),
             "Supply the complete original Library search JSON")
    _require(isinstance(selection, str) and
             re.fullmatch(r"[0-9]{3}", selection) is not None,
             "Select exactly one original three-digit search index")
    rows = result["results"] + result.get("retrieval_title_results", [])
    index = int(selection)
    _require(index < len(rows) and isinstance(rows[index], dict),
             "The selected Library result is absent")
    row = rows[index]
    metadata = row.get("metadata") or {}
    _require(isinstance(metadata, dict), "Original Library metadata is malformed")
    values = {}
    for name in ("file_id", "library_file_id", "version_id", "size_bytes"):
        top, nested = row.get(name), metadata.get(name)
        _require(top is None or nested is None or top == nested,
                 "Original Library identity fields disagree")
        values[name] = top if top is not None else nested
    for name in ("file_id", "library_file_id"):
        _require(isinstance(values[name], str) and values[name].strip() and
                 "\n" not in values[name] and len(values[name]) < 1000,
                 "The selected file requires its concrete Library identity")
    filename = row.get("name") or metadata.get("name")
    library_path = metadata.get("path") or row.get("path")
    _require(isinstance(filename, str) and filename and
             PurePosixPath(filename).name == filename and
             "\\" not in filename and "\0" not in filename,
             "Use the original filename")
    _require(not metadata.get("name") or metadata["name"] == filename,
             "Original Library filenames disagree")
    _require(isinstance(library_path, str) and library_path.startswith("/") and
             "\\" not in library_path and "\0" not in library_path and
             ".." not in PurePosixPath(library_path).parts and
             PurePosixPath(library_path).name == filename,
             "Use the selected file's canonical Library path")
    _require(type(values["size_bytes"]) is int and values["size_bytes"] >= 0,
             "The selected Library file requires its actual byte count")
    _require(values["version_id"] is None or
             type(values["version_id"]) in (str, int),
             "Preserve the original version value without inventing one")
    return {"file_id": values["file_id"],
            "library_file_id": values["library_file_id"],
            "version_id": values["version_id"], "filename": filename,
            "library_path": library_path, "bytes": values["size_bytes"]}


def _binding(plan_path, original_path, expected, *, expected_plan_id=None):
    cache = _cache()
    retained, plan, _ = cache.resolved_plan(Path(plan_path))
    if expected_plan_id is not None:
        _require(plan["plan_id"] == expected_plan_id,
                 "The original custody plan identity changed")
    _require(isinstance(original_path, str) and Path(original_path).is_absolute(),
             "Select the exact absolute container path from the frozen plan")
    entries = [entry for entry in plan["entries"]
               if entry.get("custody", {}).get("path") == original_path]
    _require(entries, "The selected container is absent from the original plan")
    for entry in entries:
        source = entry["custody"]
        _require(source["kind"] in ("file", "zip-member", "tar-member") and
                 source["sha256"] == expected["sha256"] and
                 source["size"] == expected["bytes"],
                 "The Library container differs from the original custody identity")
    return {"path": str(Path(plan_path).expanduser().absolute()),
            "plan_id": plan["plan_id"],
            "cache_root": plan["cache_root"],
            "runtime_consumers_root": plan.get("runtime_consumers_root"),
            "original_archive_path": original_path,
            "entry_ids": sorted(entry["id"] for entry in entries)}


def plan_bindings(request):
    """Return the immutable original plans sharing this exact saved container."""
    extra = request.get("additional_plans", [])
    _require(isinstance(extra, list) and len(extra) <= 255,
             "Keep the original finite archive plan selection")
    rows = [request["plan"], *extra]
    _require(all(isinstance(row, dict) for row in rows)
             and len({row["plan_id"] for row in rows}) == len(rows)
             and len({row["path"] for row in rows}) == len(rows),
             "Select each original archive plan exactly once")
    primary = rows[0]
    _require(all(row["original_archive_path"] == primary["original_archive_path"]
                 and row.get("runtime_consumers_root") == primary.get("runtime_consumers_root")
                 for row in rows),
             "Shared archive plans retain one original path and consumer registry")
    return rows


def plan_binding(request, plan_id):
    rows = [row for row in plan_bindings(request) if row["plan_id"] == plan_id]
    _require(len(rows) == 1, "Select a plan bound to this original Library request")
    return rows[0]


def _request_body(request):
    body = {key: request[key] for key in
            ("schema", "request_id", "operation_id", "plan", "archive",
             "library", "search_result", "selection", "helpers",
             "helper_directory", "download_destination")}
    if "additional_plans" in request:
        body["additional_plans"] = request["additional_plans"]
    if "materialization_root" in request:
        body["materialization_root"] = request["materialization_root"]
    return body


def _location(request_path):
    request_path = Path(request_path).expanduser().absolute()
    directory = _private_directory(request_path.parent)
    _require(request_path.name == "request.json",
             "Use the original request.json selected by prepare")
    return directory, request_path


def _request(request_path, expected_request_sha256=None):
    directory, request_path = _location(request_path)
    value = _read(request_path)
    _require(isinstance(value, dict) and value.get("schema") == REQUEST_SCHEMA and
             value.get("request_sha256") == _digest(_request_body(value)),
             "The immutable Library restore request changed")
    if expected_request_sha256 is not None:
        _require(value["request_sha256"] == expected_request_sha256,
                 "Select the original Library restore request digest")
    _require(value["request_id"] == _digest({"operation_id": value["operation_id"]}) and
             directory.name == value["request_id"],
             "The request directory differs from its original operation")
    _require(_selected(value["search_result"], value["selection"]) == value["library"],
             "The selected original Library metadata changed")
    _require(value["download_destination"] == "download",
             "Keep the original private materialization destination")
    if "materialization_root" in value:
        _require(str(_placement_path(value["materialization_root"])) == value["materialization_root"],
                 "Preserve the exact original warm placement")
    for selected in plan_bindings(value):
        actual = _binding(selected["path"], selected["original_archive_path"],
                          value["archive"], expected_plan_id=selected["plan_id"])
        _require(actual == selected, "The frozen original container binding changed")
    return directory, value


def prepare(search_result, selection, *, plan_path, original_archive_path,
            expected_sha256, expected_bytes, helper_directory, cache_root,
            operation_id, additional_plan_paths=(), materialization_root=None):
    """Freeze exact provider metadata and the original local custody identities."""
    _require(isinstance(operation_id, str) and 0 < len(operation_id) <= 240,
             "Use the stable original operation ID")
    _require(isinstance(expected_sha256, str) and HEX.fullmatch(expected_sha256) and
             type(expected_bytes) is int and expected_bytes >= 0,
             "Supply the original complete container SHA-256 and byte count")
    _require(len(_encoded(search_result)) <= METADATA_LIMIT // 2,
             "Keep the complete source metadata within the original request limit")
    library = _selected(search_result, selection)
    _require(library["bytes"] == expected_bytes,
             "The selected provider size differs from the original archive")
    archive = {"sha256": expected_sha256, "bytes": expected_bytes}
    binding = _binding(plan_path, original_archive_path, archive)
    _require(isinstance(additional_plan_paths, (list, tuple)),
             "Supply the selected original additional plan paths")
    additional = [_binding(path, original_archive_path, archive)
                  for path in additional_plan_paths]
    plan_bindings({"plan": binding, "additional_plans": additional})
    helpers = _helper_identity(helper_directory)
    parent = _private_directory(cache_root)
    request_id = _digest({"operation_id": operation_id})
    directory = _private_directory(parent / request_id, create=True)
    selected_paths = [binding["path"], *[row["path"] for row in additional]]
    protected = [str(Path(helper_directory).resolve()), str(Path(original_archive_path))]
    protected.extend(_cache().load_plan(Path(path))["cache_root"] for path in selected_paths)
    placement = _placement_option(materialization_root, directory, protected)
    value = {"schema": REQUEST_SCHEMA, "request_id": request_id,
             "operation_id": operation_id, "plan": binding, "archive": archive,
             "library": library, "search_result": search_result,
             "selection": selection, "helpers": helpers,
             "helper_directory": str(Path(helper_directory).expanduser().resolve(strict=True)),
             "download_destination": "download", **placement}
    if additional:
        value["additional_plans"] = additional
    value["request_sha256"] = _digest(_request_body(value))
    with _lock(directory):
        _save(directory / "request.json", value, create_only=True)
        state_path = directory / "state.json"
        if not state_path.exists():
            _save(state_path, {"schema": STATE_SCHEMA,
                              "request_sha256": value["request_sha256"],
                              "state": "prepared", "attempts": []}, create_only=True)
    return {"request_id": request_id, "request_sha256": value["request_sha256"],
            "request_path": str(directory / "request.json"),
            "plan_id": binding["plan_id"], "library": library,
            "capacity": capacity_requirements(directory / "request.json",
                                              expected_request_sha256=value["request_sha256"])}


def _retained_materialization(directory, value):
    """Count preserved partials and helper temporaries on their actual volume."""
    root = _materialization_directory(directory, value)
    retained, identities = [], set()
    if not root.exists():
        return {"incomplete_files": [], "temporary_files": 0,
                "allocated_bytes": 0, "temporary_allocated_bytes": 0}
    _private_directory(root)
    incomplete = []
    for parent in (root, root / "bootstrap"):
        if not parent.exists():
            continue
        _private_directory(parent)
        for entry in parent.iterdir():
            if not re.fullmatch(r"attempt-[1-9][0-9]*", entry.name):
                continue
            _private_directory(entry)
            path = entry / "incomplete-container"
            if path.exists() or path.is_symlink():
                info = path.lstat()
                _require(stat.S_ISREG(info.st_mode),
                         "Preserve an unexpected incomplete-container entry")
                incomplete.append((path, info))
    total = 0
    for path, info in incomplete:
        identity = (info.st_dev, info.st_ino)
        allocated = 0 if identity in identities else info.st_blocks * 512
        identities.add(identity)
        total += allocated
        retained.append({"path": str(path), "bytes": info.st_size,
                         "allocated_bytes": allocated})
    temporary_files, temporary_bytes = 0, 0
    temporary = root / "temporary"
    if temporary.exists() or temporary.is_symlink():
        _private_directory(temporary)
        pending = [temporary]
        while pending:
            parent = pending.pop()
            with os.scandir(parent) as entries:
                for entry in entries:
                    info = entry.stat(follow_symlinks=False)
                    identity = (info.st_dev, info.st_ino)
                    if identity not in identities:
                        identities.add(identity)
                        temporary_bytes += info.st_blocks * 512
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(Path(entry.path))
                    else:
                        temporary_files += 1
    return {"incomplete_files": retained, "temporary_files": temporary_files,
            "allocated_bytes": total + temporary_bytes,
            "temporary_allocated_bytes": temporary_bytes}


def _storage_observation(path):
    """Report the selected physical filesystem without reserving it."""
    actual = Path(path).absolute()
    while not actual.exists():
        _require(actual.parent != actual, "The selected storage path has no existing parent")
        actual = actual.parent
    _require(actual.resolve(strict=True) == actual and actual.is_dir(),
             "Observe the selected ordinary storage directory")
    info, space = actual.stat(), os.statvfs(actual)
    fragment = space.f_frsize or space.f_bsize
    filesystem = None
    mounts = Path("/proc/self/mountinfo")
    if mounts.exists():
        device = str(os.major(info.st_dev)) + ":" + str(os.minor(info.st_dev))
        for row in mounts.read_text().splitlines():
            before, separator, after = row.partition(" - ")
            fields = before.split()
            if separator and len(fields) > 4 and fields[2] == device:
                filesystem = after.split()[0]
                break
    return {"observed_path": str(actual), "device": info.st_dev,
            "filesystem": filesystem,
            "memory_backed": filesystem in ("tmpfs", "ramfs"),
            "free_bytes": space.f_bfree * fragment,
            "available_bytes": space.f_bavail * fragment,
            "caller_free_bytes": (space.f_bfree if os.geteuid() == 0 else space.f_bavail) * fragment,
            "observed_at": _now()}


def placement_requirements(directory, value):
    """Give the original controller a complete, volume-specific allowance."""
    retained = _retained_materialization(directory, value)
    size, previous = value["archive"]["bytes"], retained["allocated_bytes"]
    paths = ([
        {"path": str(directory), "allowance_bytes": METADATA_LIMIT, "purpose": "durable_metadata"},
        {"path": str(_materialization_directory(directory, value)),
         "allowance_bytes": 3 * size + previous, "purpose": "warm_materialization"}
    ] if "materialization_root" in value else [
        {"path": str(directory), "allowance_bytes": 3 * size + METADATA_LIMIT + previous,
         "purpose": "metadata_and_materialization"}])
    for row in paths:
        row["filesystem"] = _storage_observation(row["path"])
    return {"archive_bytes": size,
            "retained_incomplete_files": retained["incomplete_files"],
            "retained_incomplete_allocated_bytes": sum(
                item["allocated_bytes"] for item in retained["incomplete_files"]),
            "retained_helper_temporary_files": retained["temporary_files"],
            "retained_helper_temporary_allocated_bytes": retained["temporary_allocated_bytes"],
            "materialization_storage_allowance_bytes": 3 * size + METADATA_LIMIT + previous,
            "storage_paths": paths,
            "memory_backed_storage": "Add each memory-backed storage allowance to the original process estimate",
            "additional_restore_bytes": "Declare the actual selected original entries on their receiving filesystem",
            "admission": "Original native memory/disk controller; this report does not reserve resources",
            "helpers": list(HELPERS)}


def capacity_requirements(request_path, *, expected_request_sha256):
    """Report allocation needs; the original native controller owns admission."""
    directory, value = _request(request_path, expected_request_sha256)
    _state(directory, value)
    return placement_requirements(directory, value)

def _state(directory, value):
    state = _read(directory / "state.json")
    _require(isinstance(state, dict) and state.get("schema") == STATE_SCHEMA and
             state.get("request_sha256") == value["request_sha256"] and
             isinstance(state.get("attempts"), list),
             "Preserve the original materialization state")
    return state


def _expected_file(directory, value):
    return (_materialization_directory(directory, value) / value["download_destination"] /
            value["library"]["library_path"].lstrip("/"))


def _cached_file(directory, value):
    path = _expected_file(directory, value)
    if not path.exists() and not path.is_symlink():
        return None
    return {"path": str(path), **_file_identity(path)}


def _verified_file(directory, value):
    observed = _cached_file(directory, value)
    if observed is None:
        return None
    _require({key: observed[key] for key in ("bytes", "sha256")} == value["archive"],
             "Materialized bytes differ from the original archive; file preserved")
    return observed

def _helper_json(path):
    if not path.exists():
        return None
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        _require(stat.S_ISREG(info.st_mode) and info.st_size <= METADATA_LIMIT,
                 "Preserve the complete original helper result privately")
        raw = b""
        while block := os.read(descriptor, BLOCK):
            raw += block
            _require(len(raw) <= METADATA_LIMIT, "Helper result exceeds its metadata limit")
    finally:
        os.close(descriptor)
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        return None


def _reported_file(result, directory, value):
    """Recognize documented directory/files paths without rewriting the result."""
    if not isinstance(result, dict) or not isinstance(result.get("files"), list):
        return None
    expected = _expected_file(directory, value).absolute()
    working = _materialization_directory(directory, value)
    reported_directory = result.get("directory")
    if isinstance(reported_directory, str):
        base = Path(reported_directory)
        if not base.is_absolute():
            base = working / base
    else:
        base = working
    matches = []
    for row in result["files"]:
        if isinstance(row, str):
            paths, metadata = [row], {}
        elif isinstance(row, dict):
            paths = [row[key] for key in ("path", "local_path", "destination")
                     if isinstance(row.get(key), str)]
            metadata = row
        else:
            continue
        for raw in paths:
            path = Path(raw)
            candidates = [path] if path.is_absolute() else [working / path, base / path]
            for candidate in candidates:
                if candidate.absolute() == expected and candidate.exists():
                    for key in ("file_id", "library_file_id", "version_id"):
                        if metadata.get(key) is not None and value["library"][key] is not None:
                            _require(metadata[key] == value["library"][key],
                                     "The helper reported a different original Library identity")
                    matches.append(str(candidate))
    return expected if matches else None


def _receipt(directory, value, archive, *, basis, attempt, helper_result=None):
    receipt = {"schema": RECEIPT_SCHEMA, "state": "complete",
               "request_id": value["request_id"],
               "request_sha256": value["request_sha256"],
               "request_path": str(directory / "request.json"),
               "plan_id": value["plan"]["plan_id"],
               "custody_files": {value["plan"]["original_archive_path"]: archive["path"]},
               "archive": archive, "library": value["library"],
               "materialization_basis": basis, "attempt": attempt,
               "verified_at": _now(),
               "receipt_path": str(directory / "receipt.json")}
    if "additional_plans" in value:
        receipt["plan_ids"] = [row["plan_id"] for row in plan_bindings(value)]
    if helper_result is not None:
        receipt["helper_result_sha256"] = _digest(helper_result)
    if (directory / "receipt.json").exists():
        old = _receipt_metadata(directory, value)
        history = _private_directory(directory / "receipt-history", create=True)
        _save(history / (_digest(old) + ".json"), old, create_only=True)
    _save(directory / "receipt.json", receipt)
    return receipt


def _receipt_metadata(directory, value):
    result = _read(directory / "receipt.json")
    expected_map = {value["plan"]["original_archive_path"]:
                    str(_expected_file(directory, value))}
    expected_archive = {"path": str(_expected_file(directory, value)),
                        **value["archive"]}
    _require(isinstance(result, dict) and result.get("schema") == RECEIPT_SCHEMA and
             result.get("state") == "complete" and
             result.get("request_sha256") == value["request_sha256"] and
             result.get("request_id") == value["request_id"] and
             result.get("request_path") == str(directory / "request.json") and
             result.get("receipt_path") == str(directory / "receipt.json") and
             result.get("plan_id") == value["plan"]["plan_id"] and
             result.get("library") == value["library"] and
             result.get("custody_files") == expected_map and
             result.get("archive") == expected_archive and
             type(result.get("attempt")) is int and result["attempt"] > 0,
             "The materialization receipt differs from its original request")
    expected_plans = ([row["plan_id"] for row in plan_bindings(value)]
                      if "additional_plans" in value else None)
    _require(result.get("plan_ids") == expected_plans,
             "The helper receipt differs from the complete original plan selection")
    return result

def read_receipt(request_path, *, expected_request_sha256, expected_plan_id=None):
    """Validate the original binding and current cached bytes; never fetch."""
    directory, value = _request(request_path, expected_request_sha256)
    if expected_plan_id is not None:
        plan_binding(value, expected_plan_id)
    result = _receipt_metadata(directory, value)
    actual = _verified_file(directory, value)
    _require(actual is not None and result["archive"] == actual,
             "The verified Library cache is unavailable; use its original materialization")
    return result

@contextmanager
def hold_receipt(request_path, *, expected_request_sha256, expected_plan_id=None):
    """Keep this cache selection alive throughout an original receiving action."""
    directory, _ = _request(request_path, expected_request_sha256)
    with _lock(directory):
        yield read_receipt(request_path, expected_request_sha256=expected_request_sha256,
                           expected_plan_id=expected_plan_id)


def _download_worker(request_path, expected_request_sha256, attempt_directory, lock_fd):
    directory, value = _request(request_path, expected_request_sha256)
    attempt_directory = _private_directory(attempt_directory)
    _require(attempt_directory.parent == directory,
             "Keep the original attempt inside its selected request")
    _require(_helper_identity(value["helper_directory"]) == value["helpers"],
             "The selected current Library helper files changed")
    payload = {"result": value["search_result"], "selection": value["selection"],
               "destination": value["download_destination"]}
    # The helper owns authenticated prepare, workspace/URL transfer and xattrs.
    command = [sys.executable, "-B",
               str(Path(value["helper_directory"]) / "library_download.py")]
    stdout_path = attempt_directory / "helper-stdout.json"
    stderr_path = attempt_directory / "helper-stderr.txt"
    out_fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        err_fd = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except BaseException:
        os.close(out_fd)
        raise
    with os.fdopen(out_fd, "wb") as output, os.fdopen(err_fd, "wb") as errors:
        working = _materialization_directory(directory, value, create=True)
        completed = subprocess.run(command, input=_encoded(payload), cwd=working,
                                   stdout=output, stderr=errors, check=False,
                                   pass_fds=(lock_fd,),
                                   env=_helper_environment(directory, value))
        output.flush()
        errors.flush()
        os.fsync(output.fileno())
        os.fsync(errors.fileno())
    result = {"request_sha256": value["request_sha256"],
              "exit_code": completed.returncode, "returned_at": _now()}
    helper = _helper_json(stdout_path)
    if helper is not None:
        _save(attempt_directory / "helper-result.json", helper, create_only=True)
        result["helper_result_sha256"] = _digest(helper)
    _save(attempt_directory / "worker-result.json", result, create_only=True)
    return completed.returncode


def _reconcile(directory, value, state):
    previous = (_receipt_metadata(directory, value)
                if (directory / "receipt.json").exists() else None)
    archive = _cached_file(directory, value)
    if archive is None or {key: archive[key] for key in ("bytes", "sha256")} != value["archive"]:
        # A missing cache can be materialized again under the same immutable
        # request. An incomplete owned helper output is retained before retry.
        return None
    if previous is not None and (not state["attempts"] or
                                 previous["attempt"] >= state["attempts"][-1]["number"]):
        return read_receipt(directory / "request.json",
                            expected_request_sha256=value["request_sha256"])
    if not state["attempts"]:
        return None
    last = state["attempts"][-1]
    attempt_directory = directory / ("attempt-" + str(last["number"]))
    helper_path = attempt_directory / "helper-result.json"
    helper = _read(helper_path) if helper_path.exists() else _helper_json(
        attempt_directory / "helper-stdout.json")
    worker_path = attempt_directory / "worker-result.json"
    worker = _read(worker_path) if worker_path.exists() else None
    if worker is not None:
        _require(worker.get("request_sha256") == value["request_sha256"],
                 "The worker result belongs to a different original request")
    reported = _reported_file(helper, directory, value)
    basis = ("official_helper_result" if reported is not None and worker is not None and
             worker.get("exit_code") == 0 else "verified_original_bytes_after_helper_attempt")
    return _receipt(directory, value, archive, basis=basis, attempt=last["number"],
                    helper_result=helper)


def adopt_bootstrap(request_path, *, expected_request_sha256,
                    expected_bootstrap_sha256):
    """Bind one already completed official-helper run to its original plan.

    The general cache operator may need the whole container before the original
    cache plan can measure a prefix. Its retained bootstrap uses this request's
    exact operation directory, helper set, selection and download destination.
    This adoption never fetches, relocates bytes or accepts an outside cache.
    """
    directory, value = _request(request_path, expected_request_sha256)
    with _lock(directory):
        bootstrap_path = directory / "bootstrap-receipt.json"
        observed = _file_identity(bootstrap_path)
        _require(observed["sha256"] == expected_bootstrap_sha256,
                 "Select the exact retained original helper bootstrap receipt")
        bootstrap = _read(bootstrap_path)
        _require(_file_identity(bootstrap_path) == observed,
                 "The original bootstrap receipt changed during its read")
        expected_source = {
            "search_result": value["search_result"], "selection": value["selection"],
            "archive": value["archive"], "helpers": value["helpers"],
            "helper_directory": value["helper_directory"],
            "download_destination": value["download_destination"]}
        if "materialization_root" in value:
            expected_source["materialization_root"] = value["materialization_root"]
        _require(isinstance(bootstrap, dict) and
                 bootstrap.get("schema") == "commons.native-library-bootstrap/v1" and
                 bootstrap.get("operation_id") == value["operation_id"] and
                 bootstrap.get("request_directory") == str(directory) and
                 bootstrap.get("source") == expected_source,
                 "The original helper invocation differs from this frozen request")
        attempt = bootstrap.get("attempt", {})
        _require(isinstance(attempt, dict) and
                 type(attempt.get("number")) is int and attempt["number"] > 0 and
                 isinstance(attempt.get("started_at"), str) and
                 (attempt.get("exit_code") is None or type(attempt["exit_code"]) is int),
                 "Retain the original helper attempt and its actual return")
        _require(_helper_identity(value["helper_directory"]) == value["helpers"],
                 "The original Library helper set changed")
        stdout = directory / "bootstrap" / ("attempt-" + str(attempt["number"])) / "helper-stdout.json"
        helper = _helper_json(stdout)
        _require(bootstrap.get("helper_result_sha256") ==
                 (_digest(helper) if helper is not None else None),
                 "The original helper result changed")
        archive = _verified_file(directory, value)
        _require(archive is not None and bootstrap.get("archive") == archive,
                 "The actual complete Library bytes differ from the retained bootstrap")
        state = _state(directory, value)
        if state["attempts"]:
            _require(state["attempts"][0].get("bootstrap_sha256") == expected_bootstrap_sha256,
                     "Continue the already selected original materialization")
            recovered = _reconcile(directory, value, state)
            _require(recovered is not None,
                     "Recover the original materialization before adopting another result")
            state["state"] = "complete"
            _save(directory / "state.json", state)
            return recovered
        target = _private_directory(directory / "attempt-1", create=True)
        _save(target / "bootstrap-source.json", bootstrap, create_only=True)
        if helper is not None:
            _save(target / "helper-result.json", helper, create_only=True)
        _save(target / "worker-result.json", {
            "request_sha256": value["request_sha256"],
            "exit_code": attempt.get("exit_code"),
            "returned_at": attempt.get("returned_at"),
            "bootstrap_sha256": expected_bootstrap_sha256}, create_only=True)
        state["attempts"].append({
            "number": 1, "state": "returned", "started_at": attempt["started_at"],
            "exit_code": attempt.get("exit_code"),
            "source": "original_official_helper_bootstrap",
            "bootstrap_sha256": expected_bootstrap_sha256})
        state["state"] = "materializing"
        _save(directory / "state.json", state)
        result = _reconcile(directory, value, state)
        _require(result is not None,
                 "The exact original helper bytes must be available for adoption")
        state["state"] = "complete"
        _save(directory / "state.json", state)
        return result

def materialize(request_path, *, expected_request_sha256):
    """Run or recover one original authenticated file materialization."""
    directory, value = _request(request_path, expected_request_sha256)
    with _lock(directory) as lock_descriptor:
        state = _state(directory, value)
        recovered = _reconcile(directory, value, state)
        if recovered is not None:
            state["state"] = "complete"
            _save(directory / "state.json", state)
            return recovered
        existing = _cached_file(directory, value)
        _require(existing is None or state["attempts"],
                 "An unowned pre-existing cache file is preserved")
        _require(_helper_identity(value["helper_directory"]) == value["helpers"],
                 "Continue with the exact current helpers selected for this request")
        working = _materialization_directory(directory, value, create=True)
        _private_directory(working / value["download_destination"], create=True)
        number = len(state["attempts"]) + 1
        attempt_directory = _private_directory(directory / ("attempt-" + str(number)),
                                               create=True)
        attempt = {"number": number, "state": "materializing",
                   "started_at": _now()}
        if existing is not None:
            attempt["incomplete_file"] = {
                **existing, "preserved_path": str(_incomplete_file(directory, value, number, create=True))}
        state["attempts"].append(attempt)
        state["state"] = "materializing"
        _save(directory / "state.json", state)
        if existing is not None:
            path = Path(existing["path"])
            _require(_cached_file(directory, value) == existing,
                     "The incomplete owned file changed; preserve its original attempt")
            preserved = _incomplete_file(directory, value, number, create=True)
            _require(not preserved.exists() and not preserved.is_symlink(),
                     "Preserve the existing incomplete-file record")
            # This private path is the helper's own unsuccessful output, never
            # the original archive or a customer's application source. Rename
            # retains its actual bytes before the next explicit same-ID attempt.
            os.rename(path, preserved)
            _sync_directory(path.parent)
            _sync_directory(preserved.parent)
            moved = _file_identity(preserved)
            _require(moved == {key: existing[key] for key in ("bytes", "sha256")},
                     "The displaced incomplete bytes changed and remain preserved")
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "_download",
                   "--request", str(directory / "request.json"),
                   "--expected-request-sha256", value["request_sha256"],
                   "--attempt-directory", str(attempt_directory),
                   "--lock-fd", str(lock_descriptor)]
        # Both worker and unchanged helper retain this same flock after parent exit.
        completed = subprocess.run(command, check=False, pass_fds=(lock_descriptor,),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   env=_helper_environment(directory, value))
        state["attempts"][-1].update(state="returned", exit_code=completed.returncode)
        result = _reconcile(directory, value, state)
        state["state"] = "complete" if result is not None else "materialization_incomplete"
        _save(directory / "state.json", state)
        if result is None:
            raise LibraryCustodyError(
                "The original helper did not produce the verified container; "
                "its private attempt/result remains available for recovery")
        return result

def info(request_path, *, expected_request_sha256):
    directory, value = _request(request_path, expected_request_sha256)
    state = _state(directory, value)
    result = {"request_id": value["request_id"],
              "request_sha256": value["request_sha256"],
              "plan_id": value["plan"]["plan_id"], "library": value["library"],
              "state": state["state"], "attempt_count": len(state["attempts"]),
              "capacity": capacity_requirements(request_path,
                                  expected_request_sha256=expected_request_sha256)}
    if (directory / "receipt.json").exists():
        # A completed receipt remains historical evidence after explicit cache
        # eviction. Status must describe a cold cache without fetching anything.
        result["receipt"] = _receipt_metadata(directory, value)
    cached = _expected_file(directory, value)
    result["cache_state"] = ("present_unverified" if cached.exists()
                             and not cached.is_symlink() else "materialization_required")
    result["network_performed"] = False
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_cli = commands.add_parser("prepare")
    prepare_cli.add_argument("--search-result", required=True, type=Path)
    prepare_cli.add_argument("--selection", required=True)
    prepare_cli.add_argument("--plan", required=True, type=Path)
    prepare_cli.add_argument("--additional-plan", action="append", default=[], type=Path)
    prepare_cli.add_argument("--archive", required=True)
    prepare_cli.add_argument("--sha256", required=True)
    prepare_cli.add_argument("--bytes", required=True, type=int)
    prepare_cli.add_argument("--helper-directory", required=True, type=Path)
    prepare_cli.add_argument("--cache-root", required=True, type=Path)
    prepare_cli.add_argument("--operation-id", required=True)
    prepare_cli.add_argument("--materialization-root", type=Path,
                             help="optional private warm volume; durable request stays under cache-root")
    for name in ("materialize", "receipt", "info", "_download"):
        sub = commands.add_parser(name)
        sub.add_argument("--request", required=True, type=Path)
        sub.add_argument("--expected-request-sha256", required=True)
        if name == "_download":
            sub.add_argument("--attempt-directory", required=True, type=Path)
            sub.add_argument("--lock-fd", required=True, type=int)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            result = prepare(_read(args.search_result), args.selection,
                plan_path=args.plan, original_archive_path=args.archive,
                expected_sha256=args.sha256, expected_bytes=args.bytes,
                helper_directory=args.helper_directory, cache_root=args.cache_root,
                operation_id=args.operation_id, additional_plan_paths=args.additional_plan,
                materialization_root=args.materialization_root)
        elif args.command == "_download":
            return _download_worker(args.request, args.expected_request_sha256,
                                    args.attempt_directory, args.lock_fd)
        else:
            function = {"materialize": materialize, "receipt": read_receipt,
                        "info": info}[args.command]
            result = function(args.request,
                              expected_request_sha256=args.expected_request_sha256)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except (LibraryCustodyError, OSError, ValueError) as exc:
        # Original helper stderr is private and may include a transfer locator.
        # Only local validation errors are presented here, never helper output.
        print(json.dumps({"ok": False, "error": type(exc).__name__,
                          "message": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
