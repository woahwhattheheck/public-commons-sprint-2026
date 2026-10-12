#!/usr/bin/env python3
"""Receive the current shared merchant source; continue the original OData operation."""
import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import stat
from contextlib import contextmanager
from pathlib import Path

SCHEMA = "stellar-forge.merchant-host-native-source.v1"

def decode(envelope):
    if envelope.get("schema") != "commons.source-packet/v1" or envelope.get("encoding") != "commons-lz77-v1+base64":
        raise ValueError("Select the original Commons source-packet envelope")
    expected = envelope.get("bytes")
    if type(expected) is not int or not 0 < expected <= 64 * 1024 * 1024:
        raise ValueError("Invalid original decoded byte bound")
    packed = base64.b64decode(envelope["data"], validate=True)
    plain = bytearray()
    pos = 0
    while pos < len(packed):
        flag = packed[pos]
        pos += 1
        if flag < 128:
            count = flag + 1
            if pos + count > len(packed):
                raise ValueError("Truncated source literal")
            plain.extend(packed[pos:pos + count])
            pos += count
        else:
            count = flag - 128 + 3
            if pos + 2 > len(packed):
                raise ValueError("Truncated source reference")
            distance = packed[pos] * 256 + packed[pos + 1]
            pos += 2
            if not 1 <= distance <= len(plain):
                raise ValueError("Invalid source reference")
            for _ in range(count):
                plain.append(plain[-distance])
        if len(plain) > expected:
            raise ValueError("Source exceeded its original byte bound")
    if len(plain) != expected:
        raise ValueError("Source byte length changed")
    packet = json.loads(plain.decode("utf-8"))
    if packet.get("schema") != SCHEMA:
        raise ValueError("Select the complete current merchant host packet")
    if not isinstance(packet.get("files"), dict) or not packet["files"]:
        raise ValueError("Complete original source files are required")
    return packet

def member(source, name):
    relative = Path(name)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts or "\\" in name:
        raise ValueError("Invalid source member: " + name)
    target = source / relative
    if not target.parent.resolve().is_relative_to(source):
        raise ValueError("Source parent escapes its received copy: " + name)
    return target

def source_bytes(value):
    data = value["content"].encode("utf-8") if "content" in value else base64.b64decode(value["base64"], validate=True)
    git_sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if git_sha != value["gitBlobSha"]:
        raise ValueError("Original Git source bytes changed")
    return data

def _fsync_directory(path):
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def _write_bytes(path, data, immutable=False):
    """Install complete bytes; an interrupted temporary never becomes the final file."""
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise ValueError("Expected a received regular file: " + str(path))
        if path.read_bytes() == data:
            return
        if immutable:
            raise ValueError("Retained receiving identity changed: " + str(path))
    descriptor, temporary = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

def _write_json(path, value, immutable=False):
    _write_bytes(path, (json.dumps(value, sort_keys=True, indent=2) + "\n").encode(),
        immutable=immutable)

@contextmanager
def _source_lease(path):
    """The OS releases this same-destination lock after a crash; keep its inode."""
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "r+b", buffering=0) as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Expected a regular source receiving lock")
        if os.name == "nt":
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b"\0")
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise RuntimeError("This source destination has an active receiver") from error
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError("This source destination has an active receiver") from error
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

def _remove_owned(path):
    if path.is_symlink() or not path.is_dir():
        path.unlink()
    else:
        shutil.rmtree(path)


def _path_exists(path):
    return path.exists() or path.is_symlink()

def _root_identity(path):
    observed = path.lstat()
    if not stat.S_ISDIR(observed.st_mode):
        raise ValueError("Expected a regular source directory: " + str(path))
    return {"device": observed.st_dev, "inode": observed.st_ino}

def _source_file(path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Expected a regular source member: " + str(path))
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    if size != before.st_size or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("Original source changed during read: " + str(path))
    return {"kind": "file", "bytes": size, "sha256": digest.hexdigest(),
        "mode": stat.S_IMODE(before.st_mode) & 0o777}

def _source_value(path):
    observed = path.lstat()
    if stat.S_ISDIR(observed.st_mode):
        return {"kind": "directory"}
    if stat.S_ISLNK(observed.st_mode):
        target = os.readlink(path)
        after = path.lstat()
        if (observed.st_dev, observed.st_ino, observed.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_ctime_ns):
            raise ValueError("Original source link changed: " + str(path))
        return {"kind": "symlink", "target": target}
    return _source_file(path)

def _source_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def _donor_inventory(donor):
    """Bind the whole donor copy, including source outside explicit postimages."""
    result = {}
    def visit(directory, prefix=""):
        before = directory.stat(follow_symlinks=False)
        for item in sorted(directory.iterdir(), key=lambda path: path.name):
            if item.name in (".git", "node_modules"):
                continue
            name = prefix + item.name
            value = _source_value(item)
            result[name] = value
            if value["kind"] == "directory":
                visit(item, name + "/")
        after = directory.stat(follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError("The donor changed during complete source selection")
    visit(donor)
    return result

def _same_source_value(actual, expected):
    return actual.get("kind") == expected.get("kind") and all(
        actual.get(key) == value for key, value in expected.items())

def _matches_source(path, expected):
    if not _path_exists(path):
        return False
    return _same_source_value(_source_value(path), expected)

def _retain_incomplete(path, preparation, name):
    """Preserve every unrecognized interrupted byte before completing its path."""
    retained = preparation / "retained-incomplete"
    retained.mkdir(mode=0o700, exist_ok=True)
    item = Path(tempfile.mkdtemp(prefix="member-", dir=retained))
    _write_json(item / "original-path.json", {"path": name}, immutable=True)
    os.rename(path, item / "member")
    _fsync_directory(item)
    _fsync_directory(path.parent)
    _fsync_directory(retained)

def _known_source_bytes(path, expected_values):
    if not _path_exists(path):
        return False
    actual = _source_value(path)
    # Mode-only differences do not require another copy of identical bytes.
    return any(value and _same_source_value(actual,
        {key: item for key, item in value.items() if key != "mode"}) for value in expected_values)

def _prepare_source_target(path, name, desired, preparation, known=()):
    if _matches_source(path, desired):
        return True
    if _path_exists(path):
        if _known_source_bytes(path, (desired, *known)):
            if path.is_symlink() or desired["kind"] != "file":
                _remove_owned(path)
                _fsync_directory(path.parent)
        else:
            _retain_incomplete(path, preparation, name)
    return False

def _selected_inventory(packet, donor_inventory, modules):
    values = {name: dict(value) for name, value in donor_inventory.items()}
    prefix = "stellar/scf-starforge-20261009/distribution/contributions/"
    declared = _declared_contributions(packet)
    for name in list(values):
        if name.startswith(prefix) and "/" not in name[len(prefix):] and name.endswith(".json") and name[len(prefix):] not in declared:
            del values[name]
    for name, value in packet["files"].items():
        relative = Path(name)
        if relative.as_posix() != name or any(part in (".git", "node_modules") for part in relative.parts):
            raise ValueError("Use canonical original source member paths: " + name)
        for parent in reversed(relative.parents):
            if parent == Path("."):
                continue
            key = parent.as_posix()
            if key in values and values[key]["kind"] != "directory":
                raise ValueError("Selected source parent conflicts with its donor: " + key)
            values[key] = {"kind": "directory"}
        if name in values and values[name]["kind"] == "directory":
            raise ValueError("Selected source file conflicts with a donor directory: " + name)
        data = source_bytes(value)
        values[name] = {"kind": "file", "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}
    values["node_modules"] = {"kind": "symlink", "target": str(modules)}
    return values

def _verify_complete_source(source, expected, *, exact=False):
    _root_identity(source)
    for name, value in sorted(expected.items()):
        if not _matches_source(member(source, name), value):
            raise ValueError("The complete received source changed: " + name)
    if not exact:
        return
    observed = {}
    def visit(directory, prefix=""):
        before = directory.lstat()
        for item in sorted(directory.iterdir(), key=lambda path: path.name):
            name = prefix + item.name
            mode = item.lstat().st_mode
            kind = ("symlink" if stat.S_ISLNK(mode) else
                "directory" if stat.S_ISDIR(mode) else
                "file" if stat.S_ISREG(mode) else "other")
            observed[name] = kind
            if kind == "directory":
                visit(item, name + "/")
        after = directory.lstat()
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError("Received source inventory changed during inspection")
    visit(source)
    for name in sorted(set(observed) | set(expected)):
        if name not in expected:
            raise ValueError("Unexpected received source member is preserved: " + name)
        if observed.get(name) != expected[name]["kind"]:
            raise ValueError("Received source member inventory changed: " + name)

def _retain_extras(source, expected, preparation):
    def visit(directory, prefix=""):
        for item in sorted(directory.iterdir(), key=lambda path: path.name):
            name = prefix + item.name
            if name not in expected:
                _retain_incomplete(item, preparation, name)
            elif expected[name]["kind"] == "directory":
                visit(item, name + "/")
    visit(source)

def _read_source_json(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected an original regular receiving record: " + str(path))
    return json.loads(path.read_text())

def _verify_selection_tree(packet, source, modules, selected):
    inventory = _verify_received_source(packet, source, modules)
    if selected.get("files") != inventory:
        raise ValueError("The selected source member inventory changed")
    complete = selected.get("sourceInventory")
    if complete is not None:
        if _source_digest(complete) != selected.get("sourceInventorySha256"):
            raise ValueError("The complete source inventory identity changed")
        _verify_complete_source(source, complete, exact=True)
    return inventory

def _copy_donor(original, received, inventory, preparation, selected):
    """Resume frozen donor bytes; complete copied files survive donor retirement."""
    if received.is_symlink() or (received.exists() and not received.is_dir()):
        raise ValueError("The owned donor preparation is not a directory")
    received.mkdir(parents=True, exist_ok=True, mode=0o700)
    received = received.resolve(strict=True)
    for name, expected in sorted(inventory.items(),
            key=lambda item: (len(Path(item[0]).parts), item[0])):
        item, target = original / name, member(received, name)
        if _prepare_source_target(target, name, expected, preparation, (selected.get(name),)):
            continue
        if expected["kind"] == "directory":
            target.mkdir(mode=0o700)
            _fsync_directory(target.parent)
        elif expected["kind"] == "symlink":
            target.symlink_to(expected["target"], target_is_directory=item.is_dir())
            _fsync_directory(target.parent)
        else:
            descriptor, temporary = tempfile.mkstemp(prefix=".receiving-", dir=target.parent)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
                    incoming = os.open(item, flags)
                    with os.fdopen(incoming, "rb") as source_stream:
                        before = os.fstat(source_stream.fileno())
                        if not stat.S_ISREG(before.st_mode):
                            raise ValueError("Expected original regular donor source: " + name)
                        digest = hashlib.sha256()
                        size = 0
                        while True:
                            data = source_stream.read(1024 * 1024)
                            if not data:
                                break
                            digest.update(data)
                            size += len(data)
                            stream.write(data)
                        after = os.fstat(source_stream.fileno())
                    if size != before.st_size or (before.st_dev, before.st_ino, before.st_size,
                            before.st_mtime_ns, before.st_ctime_ns) != (
                            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise ValueError("Original donor changed while copying: " + name)
                    if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
                        raise ValueError("Donor bytes differ from the original prepared source: " + name)
                    stream.flush()
                    os.chmod(temporary, expected["mode"])
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
                _fsync_directory(target.parent)
            finally:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
    _verify_complete_source(received, inventory)
    _fsync_directory(received)

def _declared_contributions(packet):
    prefix = "stellar/scf-starforge-20261009/distribution/contributions/"
    declared = {name.rsplit("/", 1)[-1] for name in packet["files"]
        if name.startswith(prefix) and name.endswith(".json")}
    if len(declared) != packet["contributionCount"]:
        raise ValueError("The original contribution inventory changed")
    return declared

def _verify_received_source(packet, source, modules):
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Expected the original received source directory")
    root = source.resolve(strict=True)
    inventory = []
    for name, value in sorted(packet["files"].items()):
        data = source_bytes(value)
        target = member(root, name)
        if target.is_symlink() or not target.is_file() or target.read_bytes() != data:
            raise ValueError("Received source changed: " + name)
        inventory.append({"path": name, "gitBlobSha": value["gitBlobSha"], "bytes": len(data)})
    contribution_root = root / "stellar/scf-starforge-20261009/distribution/contributions"
    if {path.name for path in contribution_root.glob("*.json")} != _declared_contributions(packet):
        raise ValueError("The complete received contribution inventory changed")
    dependency_link = root / "node_modules"
    if not dependency_link.is_symlink() or dependency_link.resolve(strict=True) != modules:
        raise ValueError("The selected installed Node dependencies changed")
    return inventory

def _selection_matches(selected, identity, donor, source, modules):
    return (selected.get("schema") == "stellar-forge.merchant-host-native-selection.v1"
        and selected.get("packetSha256") == identity
        and selected.get("donor") == str(donor)
        and selected.get("source") == str(source)
        and selected.get("nodeModules") == str(modules))

def _source_locations(packet, donor, source, node_modules):
    # A complete received source does not require its retired donor to exist.
    donor = Path(donor).resolve()
    supplied = Path(os.path.abspath(source))
    if supplied == supplied.parent:
        raise ValueError("Select a private named source directory")
    source = supplied.parent.resolve() / supplied.name
    modules = Path(node_modules).resolve()
    if source == donor or source.is_relative_to(donor) or donor.is_relative_to(source):
        raise ValueError("Use a disjoint private source directory")
    if source == modules or source.is_relative_to(modules) or modules.is_relative_to(source):
        raise ValueError("Keep the installed Node dependencies outside the received source")
    if source.is_symlink():
        raise ValueError("Select a private source directory, not a symlink")
    identity = _source_digest(packet)
    _declared_contributions(packet)
    for name, value in packet["files"].items():
        relative = Path(name)
        if (relative.is_absolute() or not relative.parts or ".." in relative.parts
                or "\\" in name or relative.as_posix() != name):
            raise ValueError("Invalid original source member: " + name)
        source_bytes(value)
    binding = {"schema": "stellar-forge.merchant-host-native-preparation.v1",
        "packetSha256": identity, "donor": str(donor), "source": str(source),
        "nodeModules": str(modules)}
    binding_sha = _source_digest(binding)
    return {"donor": donor, "source": source, "modules": modules,
        "identity": identity, "binding": binding, "bindingSha256": binding_sha,
        "preparation": source.parent / (".merchant-host-preparation-" + binding_sha),
        "selectionFile": source.parent / (source.name + ".source-selection.json"),
        "lock": source.parent / (".merchant-host-receiver-" +
            hashlib.sha256(str(source).encode()).hexdigest() + ".lock")}

def _existing_preparation(paths):
    preparation = paths["preparation"]
    if not _path_exists(preparation):
        return False
    _root_identity(preparation)
    if _read_source_json(preparation / "identity.json") != paths["binding"]:
        raise ValueError("Existing preparation belongs to another source selection")
    return True

def _donor_snapshot(paths):
    donor = paths["donor"]
    if donor.is_symlink() or not donor.is_dir():
        raise ValueError("The original donor is required to finish uncopied source")
    files = _donor_inventory(donor)
    return {"schema": "stellar-forge.merchant-host-native-donor-source.v1",
        "bindingSha256": paths["bindingSha256"], "files": files,
        "sha256": _source_digest(files)}

def _read_donor_snapshot(paths):
    snapshot = _read_source_json(paths["preparation"] / "donor-source.json")
    if (snapshot.get("schema") != "stellar-forge.merchant-host-native-donor-source.v1"
            or snapshot.get("bindingSha256") != paths["bindingSha256"]
            or not isinstance(snapshot.get("files"), dict)
            or _source_digest(snapshot["files"]) != snapshot.get("sha256")):
        raise ValueError("The frozen donor source selection changed")
    return snapshot

def _legacy_record(paths):
    selection_file = paths["selectionFile"]
    return {"schema": "stellar-forge.merchant-host-native-legacy-source.v1",
        "bindingSha256": paths["bindingSha256"],
        "sourceIdentity": _root_identity(paths["source"]),
        "incompleteSelection": _source_file(selection_file) if _path_exists(selection_file) else None}

def _adopt_legacy_source(paths, resume_incomplete):
    """Move the existing tree into its original preparation; preserve unknown bytes there."""
    preparation, source = paths["preparation"], paths["source"]
    staged, legacy_file = preparation / "tree", preparation / "legacy-source.json"
    if not legacy_file.exists():
        if not _path_exists(source):
            return
        if not resume_incomplete:
            raise ValueError("Existing interrupted source can resume with the same selection and --resume-incomplete")
        if _path_exists(staged):
            raise ValueError("Both source and preparation exist; retain the original directories for inspection")
        _write_json(legacy_file, _legacy_record(paths), immutable=True)
    legacy = _read_source_json(legacy_file)
    if (legacy.get("schema") != "stellar-forge.merchant-host-native-legacy-source.v1"
            or legacy.get("bindingSha256") != paths["bindingSha256"]):
        raise ValueError("The original incomplete source adoption changed")
    if _path_exists(source):
        if _path_exists(staged) or _root_identity(source) != legacy["sourceIdentity"]:
            raise ValueError("The original incomplete source directory changed")
        os.rename(source, staged)
        _fsync_directory(source.parent)
        _fsync_directory(preparation)
    if not _path_exists(staged) or _root_identity(staged) != legacy["sourceIdentity"]:
        raise ValueError("The retained incomplete source directory is missing or changed")
    selection_file = paths["selectionFile"]
    if _path_exists(selection_file):
        if legacy.get("incompleteSelection") is None or _source_file(selection_file) != legacy["incompleteSelection"]:
            raise ValueError("The incomplete original selection receipt changed")
        _retain_incomplete(selection_file, preparation, "$source-selection")

def _read_matching_selection(packet, paths, selection_file):
    selected = _read_source_json(selection_file)
    if not isinstance(selected, dict) or not _selection_matches(selected, paths["identity"],
            paths["donor"], paths["source"], paths["modules"]):
        raise ValueError("Existing source belongs to another received selection")
    _verify_selection_tree(packet, paths["source"], paths["modules"], selected)
    return selected

def _publish_ready_sidecar(packet, paths):
    ready = _read_source_json(paths["preparation"] / "ready-selection.json")
    if not _selection_matches(ready, paths["identity"], paths["donor"],
            paths["source"], paths["modules"]):
        raise ValueError("Completed preparation belongs to another received selection")
    _verify_selection_tree(packet, paths["source"], paths["modules"], ready)
    _write_json(paths["selectionFile"], ready, immutable=True)
    return ready

def materialize(packet, donor, source, node_modules, *, resume_incomplete=False):
    """Resume the original source preparation and publish one complete received edition."""
    paths = _source_locations(packet, donor, source, node_modules)
    donor, source, modules = (paths[key] for key in ("donor", "source", "modules"))
    preparation, selection_file = paths["preparation"], paths["selectionFile"]
    if not modules.is_dir():
        raise ValueError("Select the original installed Node dependencies")
    source.parent.mkdir(parents=True, exist_ok=True)
    with _source_lease(paths["lock"]):
        if _path_exists(selection_file):
            try:
                return _read_matching_selection(packet, paths, selection_file)
            except json.JSONDecodeError:
                # The original direct-write receiver could leave a truncated sidecar.
                # Adoption retains those exact bytes; a valid different selection is never replaced.
                if not resume_incomplete and not (preparation / "legacy-source.json").is_file():
                    raise ValueError("The interrupted selection can resume with --resume-incomplete")
        owned = _existing_preparation(paths)
        staged, ready_file = preparation / "tree", preparation / "ready-selection.json"
        if owned and ready_file.is_file():
            if source.exists() and not _path_exists(staged):
                return _publish_ready_sidecar(packet, paths)
            if not _path_exists(source) and staged.is_dir():
                ready = _read_source_json(ready_file)
                if not _selection_matches(ready, paths["identity"], donor, source, modules):
                    raise ValueError("Completed preparation belongs to another received selection")
                _verify_selection_tree(packet, staged, modules, ready)
                os.rename(staged, source)
                _fsync_directory(source.parent)
                _write_json(selection_file, ready, immutable=True)
                return ready
            raise ValueError("Completed preparation has conflicting source directories")
        if not owned:
            if _path_exists(source) and not resume_incomplete:
                raise ValueError("Existing interrupted source can resume with the same selection and --resume-incomplete")
            if _path_exists(selection_file) and not _path_exists(source):
                raise ValueError("The original incomplete source directory is missing")
            snapshot = _donor_snapshot(paths)
            legacy = _legacy_record(paths) if _path_exists(source) else None
            candidate = Path(tempfile.mkdtemp(prefix=".merchant-host-preparing-", dir=source.parent))
            try:
                _write_json(candidate / "identity.json", paths["binding"], immutable=True)
                _write_json(candidate / "donor-source.json", snapshot, immutable=True)
                if legacy is not None:
                    _write_json(candidate / "legacy-source.json", legacy, immutable=True)
                _fsync_directory(candidate)
                os.rename(candidate, preparation)
                _fsync_directory(source.parent)
            finally:
                if candidate.exists():
                    shutil.rmtree(candidate)
        _adopt_legacy_source(paths, resume_incomplete)
        snapshot_file = preparation / "donor-source.json"
        if not snapshot_file.exists():
            # Upgrade the original staged receiver in place before any further copy.
            _write_json(snapshot_file, _donor_snapshot(paths), immutable=True)
        snapshot = _read_donor_snapshot(paths)
        expected = _selected_inventory(packet, snapshot["files"], modules)
        copied_file = preparation / "donor-complete.json"
        copied_identity = {"schema": "stellar-forge.merchant-host-native-donor.v1",
            "bindingSha256": paths["bindingSha256"]}
        if _path_exists(copied_file):
            if _read_source_json(copied_file) != copied_identity or not staged.is_dir():
                raise ValueError("Retained donor preparation changed")
            # Postimages may already be present. Verify/recover only the untouched donor members.
            unchanged = {name: value for name, value in snapshot["files"].items()
                if name not in packet["files"] and name in expected}
            _copy_donor(donor, staged, unchanged, preparation, expected)
        else:
            _copy_donor(donor, staged, snapshot["files"], preparation, expected)
            staged.chmod(0o700)
            _write_json(copied_file, copied_identity, immutable=True)
        staged = staged.resolve(strict=True)
        for name, value in sorted(expected.items(),
                key=lambda item: (len(Path(item[0]).parts), item[0])):
            if value["kind"] != "directory":
                continue
            target = member(staged, name)
            if not _prepare_source_target(target, name, value, preparation):
                target.mkdir(mode=0o700)
                _fsync_directory(target.parent)
        for name, value in sorted(packet["files"].items()):
            target = member(staged, name)
            desired = expected[name]
            if not _prepare_source_target(target, name, desired, preparation,
                    (snapshot["files"].get(name),)):
                _write_bytes(target, source_bytes(value))
        dependency_link = staged / "node_modules"
        if not _prepare_source_target(dependency_link, "node_modules", expected["node_modules"],
                preparation):
            dependency_link.symlink_to(modules, target_is_directory=True)
            _fsync_directory(staged)
        _retain_extras(staged, expected, preparation)
        _verify_complete_source(staged, expected, exact=True)
        inventory = _verify_received_source(packet, staged, modules)
        complete = {name: _source_value(member(staged, name)) for name in sorted(expected)}
        selection = {"schema": "stellar-forge.merchant-host-native-selection.v1",
            "sourceCommit": packet["sourceCommit"], "acceptedJoins": packet.get("acceptedJoins", []),
            "packetSha256": paths["identity"], "originalPacketBlob": packet["originalPacketBlob"],
            "donor": str(donor), "source": str(source), "nodeModules": str(modules),
            "contributionCount": len(_declared_contributions(packet)), "providerCount": packet["providerCount"],
            "files": inventory, "donorInventorySha256": snapshot["sha256"],
            "sourceInventory": complete, "sourceInventorySha256": _source_digest(complete),
            "retainedIncomplete": str(preparation / "retained-incomplete")}
        _write_json(ready_file, selection, immutable=True)
        _fsync_directory(staged)
        os.rename(staged, source)
        _fsync_directory(source.parent)
        _write_json(selection_file, selection, immutable=True)
        return selection

def inspect_materialization(packet, donor, source, node_modules):
    """Read the existing receiving state without creating a lease, directory or operation."""
    paths = _source_locations(packet, donor, source, node_modules)
    source, preparation = paths["source"], paths["preparation"]
    result = {"source": str(source), "packetSha256": paths["identity"],
        "selection": str(paths["selectionFile"]), "preparation": str(preparation),
        "retainedIncomplete": str(preparation / "retained-incomplete")}
    if _path_exists(paths["selectionFile"]):
        try:
            selection = _read_matching_selection(packet, paths, paths["selectionFile"])
            return {**result, "state": "MERCHANT_SOURCE_READY",
                "files": len(selection["files"]), "contributions": selection["contributionCount"],
                "providers": selection["providerCount"],
                "completeInventory": selection.get("sourceInventorySha256")}
        except json.JSONDecodeError:
            result["incompleteSelection"] = True
    if not _existing_preparation(paths):
        return {**result, "state": "MERCHANT_SOURCE_INCOMPLETE" if _path_exists(source)
            else "MERCHANT_SOURCE_UNPREPARED", "resumeIncomplete": _path_exists(source)}
    staged, ready_file = preparation / "tree", preparation / "ready-selection.json"
    if (preparation / "donor-source.json").is_file():
        snapshot = _read_donor_snapshot(paths)
        result.update(donorMembers=len(snapshot["files"]), donorInventorySha256=snapshot["sha256"])
    result["legacyAdopted"] = (preparation / "legacy-source.json").is_file()
    if ready_file.is_file():
        ready = _read_source_json(ready_file)
        if not _selection_matches(ready, paths["identity"], paths["donor"], source, paths["modules"]):
            raise ValueError("Completed preparation belongs to another received selection")
        selected_tree = source if source.exists() and not _path_exists(staged) else staged
        _verify_selection_tree(packet, selected_tree, paths["modules"], ready)
        return {**result, "state": "MERCHANT_SOURCE_SELECTION_PENDING" if selected_tree == source
            else "MERCHANT_SOURCE_READY_TO_PUBLISH", "files": len(ready["files"])}
    return {**result, "state": "MERCHANT_SOURCE_PREPARING", "staged": str(staged),
        "phase": "APPLYING_SELECTION" if (preparation / "donor-complete.json").is_file()
            else "COPYING_DONOR"}

def run_odata(packet, source, node, connection=None, output=None):
    original = packet["operations"]["odata"]
    connection = Path(connection or original["sourceConnection"]).resolve(strict=True)
    output = Path(output or original["originalOutput"]).absolute()
    if output.exists():
        print(json.dumps({"state": "ORIGINAL_OUTPUT", "path": str(output),
            "members": sorted(path.name for path in output.iterdir())}), flush=True)
    argv = [str(node), "--max-old-space-size=768", str(Path(source) / original["entry"]),
        "--connection", str(connection), "--workspace", original["workspace"],
        "--edition", original["edition"], "--profile", original["profile"],
        "--fields", ",".join(original["fields"]), "--name", original["name"],
        "--expected-semantic", original["expectedSemanticSha256"], "--out", str(output)]
    print(json.dumps({"state": "ORIGINAL_ODATA_STARTING", "source": str(source),
        "edition": original["edition"], "sourceConnection": str(connection),
        "output": str(output), "expectedSemanticSha256": original["expectedSemanticSha256"]}), flush=True)
    return subprocess.run(argv, cwd=source, env=os.environ.copy()).returncode

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--donor")
    parser.add_argument("--node-modules")
    parser.add_argument("--node")
    parser.add_argument("--run-odata", action="store_true")
    parser.add_argument("--resume-incomplete", action="store_true",
        help="Adopt and preserve an existing interrupted source directory")
    parser.add_argument("--inspect", action="store_true", help="Read receiving state without changing it")
    parser.add_argument("--connection")
    parser.add_argument("--out")
    args = parser.parse_args()
    packet_file = Path(args.packet).resolve(strict=True)
    packet = decode(json.loads(packet_file.read_text()))
    if args.inspect:
        if args.run_odata or args.resume_incomplete:
            parser.error("--inspect is a read-only receiving command")
        print(json.dumps(inspect_materialization(packet,
            args.donor or packet["originalDonor"], args.source,
            args.node_modules or packet["originalNodeModules"])), flush=True)
        return 0
    selection = materialize(packet, args.donor or packet["originalDonor"], args.source,
        args.node_modules or packet["originalNodeModules"], resume_incomplete=args.resume_incomplete)
    print(json.dumps({"state": "MERCHANT_SOURCE_READY", "source": selection["source"],
        "selection": str(Path(selection["source"]).parent / (Path(selection["source"]).name + ".source-selection.json")),
        "sourceCommit": selection["sourceCommit"], "acceptedJoins": selection.get("acceptedJoins", []), "files": len(selection["files"]),
        "contributions": selection["contributionCount"], "providers": selection["providerCount"]}), flush=True)
    if args.run_odata:
        return run_odata(packet, selection["source"], args.node or packet["node"], args.connection, args.out)
    return 0

if __name__ == "__main__":
    sys.exit(main())
