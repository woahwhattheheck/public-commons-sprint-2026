#!/usr/bin/env python3
# MIT.
"""Adopt the complete feed SDK into B028's original undispatched 43c source.

This is source preparation for the existing native record. It does not start,
cancel, resize or replace that record. The complete original request and the
five replaced source preimages remain private beside the existing project.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile

SCHEMA = "stellar-forge.feed-mcp-sdk-source-adoption.v1"
SELECTION_SCHEMA = "stellar-forge.feed-mcp-sdk-source-selection.v1"
SELECTION_BLOB = "cbe7f008696f6e2d63dca8481c06ce71c1e265ce"
DRIVER_BLOB = "73913083955ee6f5d1be32f368b3b544384331f3"
OPERATION = "scf-feed-mcp-native-b028-20261012"
PROJECT = Path("/workspace/scratch/b0285b3810b3")
SOURCE = PROJECT / "feed-mcp-native-source"
DRIVER = PROJECT / "feed-mcp-native-journey.mjs"
RECORD = Path("/workspace/shared/swarm/jobs/native/43c215ef466dc1d71adcafa1105db345cb66feadc3712c3999af5937825044b6")
ADOPTION = PROJECT / "feed-mcp-sdk-adoption-055c5231"
HOST = PROJECT / "native-shared-queue/current-host"
HOST_SHA256 = "2bc8cd1e19dfce1257c060d13f77177c8d4a0e0003d7839f6659c8b831f74dbb"
NODE = "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("ascii")


def identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, stat.S_IMODE(value.st_mode))


def read_regular(path, maximum=16 * 1024 * 1024):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "Preserve the complete original regular file: " + str(path))
        pieces, size = [], 0
        while True:
            part = os.read(descriptor, min(1024 * 1024, maximum + 1 - size))
            if not part:
                break
            pieces.append(part)
            size += len(part)
            require(size <= maximum, "Original file changed during reading: " + str(path))
        require(identity(before) == identity(os.fstat(descriptor)),
                "Original file changed during reading: " + str(path))
        return b"".join(pieces), before
    finally:
        os.close(descriptor)


def match(data, expected):
    return len(data) == expected["bytes"] and blob(data) == expected["sha"]


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def directory(path):
    path = Path(path)
    require(path == PROJECT or PROJECT in path.parents,
            "Use the original project for source adoption")
    require(PROJECT.resolve(strict=True) == PROJECT and PROJECT.is_dir(),
            "Keep the original canonical B028 project")
    current = PROJECT
    for component in path.relative_to(PROJECT).parts:
        current = current / component
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            os.mkdir(current, 0o700)
            sync_directory(current.parent)
            metadata = current.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode),
                "Preserve the original regular source directory: " + str(current))
    return path


def source_path(name):
    relative = PurePosixPath(name)
    require(isinstance(name, str) and name and not relative.is_absolute() and
            str(relative) == name and all(x not in ("", ".", "..") for x in relative.parts),
            "Use one canonical original source path")
    path = SOURCE.joinpath(*relative.parts)
    require(SOURCE in path.parents, "Keep source members inside the original source")
    current = SOURCE
    for component in relative.parts[:-1]:
        current = current / component
        if os.path.lexists(current):
            require(stat.S_ISDIR(current.lstat().st_mode),
                    "Preserve the original regular source parent: " + str(current))
    return path


def cleanup_temporary(path, owned):
    try:
        now = Path(path).lstat()
    except FileNotFoundError:
        return
    if (now.st_dev, now.st_ino) == (owned.st_dev, owned.st_ino):
        os.unlink(path)


def staged(path, data, mode=0o600):
    directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    owned = os.fstat(descriptor)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as output:
            descriptor = None
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        return Path(temporary), owned
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        cleanup_temporary(temporary, owned)
        raise


def retain(path, data, mode=0o600):
    """Publish one fsynced complete private file, or reopen its exact postimage."""
    path = Path(path)
    directory(path.parent)
    if os.path.lexists(path):
        actual, metadata = read_regular(path)
        require(actual == data and stat.S_IMODE(metadata.st_mode) == mode,
                "Preserve a different retained adoption: " + str(path))
        sync_directory(path.parent)
        return
    temporary, owned = staged(path, data, mode)
    try:
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            actual, metadata = read_regular(path)
            require(actual == data and stat.S_IMODE(metadata.st_mode) == mode,
                    "A different writer owns the retained adoption: " + str(path))
        sync_directory(path.parent)
    finally:
        cleanup_temporary(temporary, owned)


def replace_original(path, data, expected, backup, mode=0o600):
    """Preserve the original inode's bytes before replacing this selected leaf."""
    current, observed = read_regular(path)
    if current == data:
        saved, metadata = read_regular(backup)
        require(match(saved, expected) and stat.S_IMODE(metadata.st_mode) == mode,
                "Retain the original source preimage before reopening its replacement")
        require(stat.S_IMODE(observed.st_mode) == mode,
                "Preserve the selected private source mode")
        sync_directory(path.parent)
        return
    require(match(current, expected) and stat.S_IMODE(observed.st_mode) == mode,
            "Preserve a changed original source: " + str(path))
    retain(backup, current, mode)
    temporary, owned = staged(path, data, mode)
    try:
        latest, metadata = read_regular(path)
        require(identity(metadata) == identity(observed) and latest == current,
                "The selected original source changed before publication: " + str(path))
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        cleanup_temporary(temporary, owned)


def selection_payload(payload):
    require(isinstance(payload, dict) and payload.get("schema") == SCHEMA,
            "Use the complete original source-adoption packet")
    selected = payload["selection"]
    data = selected["source"].encode("utf-8")
    require(selected["sha"] == SELECTION_BLOB and match(data, selected),
            "Select the exact reviewed original source manifest")
    selection = json.loads(data)
    require(selection["schema"] == SELECTION_SCHEMA and
            selection["operationId"] == OPERATION and
            selection["project"] == str(PROJECT) and
            selection["sourceRoot"] == str(SOURCE) and
            selection["record"] == str(RECORD) and
            selection["filesCount"] == len(selection["files"]) == 341 and
            selection["originalInventory"]["files"] == 329 and
            len(selection["overlay"]) == 17,
            "Keep the original B028 source and complete SDK overlay")
    driver = payload["driver"]
    driver_bytes = driver["source"].encode("utf-8")
    require(driver["sha"] == DRIVER_BLOB and match(driver_bytes, driver),
            "Select the complete reviewed original customer driver")
    files = {}
    for entry in payload["files"]:
        require(entry["path"] not in files, "Do not repeat a selected source member")
        source_path(entry["path"])
        body = entry["source"].encode("utf-8")
        require(match(body, entry), "Retain the exact complete source bytes: " + entry["path"])
        files[entry["path"]] = (entry, body)
    require(set(files) == {entry["path"] for entry in selection["overlay"]},
            "Include every SDK and maintained prerequisite source")
    for entry in selection["overlay"]:
        require(files[entry["path"]][0]["sha"] == entry["sha"] and
                files[entry["path"]][0]["bytes"] == entry["bytes"] and entry["mode"] == 0o600,
                "The selected source overlay changed")
    require(len({row["path"] for row in selection["files"]}) == 341 and
            sum(row["bytes"] for row in selection["files"]) == selection["bytes"],
            "Keep the complete original source census")
    return selection, data, driver_bytes, files


def check_sources(selection):
    require(SOURCE.resolve(strict=True) == SOURCE and SOURCE.is_dir(),
            "Keep the original canonical native source root")
    inventory, _ = read_regular(SOURCE / selection["originalInventory"]["name"])
    require(match(inventory, selection["originalInventory"]),
            "Preserve the original donor inventory unchanged")
    dependency = SOURCE / selection["dependency"]["path"]
    require(dependency.is_symlink() and
            str(dependency.resolve(strict=True)) == selection["dependency"]["target"],
            "Keep the original installed dependency link")
    opml, _ = read_regular(Path(selection["opml"]["path"]))
    require(len(opml) == selection["opml"]["bytes"] and digest(opml) == selection["opml"]["sha256"],
            "Keep the original complete 573-subscription OPML")
    overlay = {row["path"]: row for row in selection["overlay"]}
    all_after = True
    for row in selection["files"]:
        path = source_path(row["path"])
        selected = overlay.get(row["path"])
        if not os.path.lexists(path):
            require(selected is not None and selected["before"] is None,
                    "Restore the missing original source before adoption: " + row["path"])
            all_after = False
            continue
        data, metadata = read_regular(path)
        if match(data, row):
            if selected:
                require(stat.S_IMODE(metadata.st_mode) == selected["mode"],
                        "Preserve the selected private SDK file mode: " + row["path"])
            continue
        require(selected is not None and selected["before"] is not None and
                match(data, selected["before"]) and
                stat.S_IMODE(metadata.st_mode) == selected["before"]["mode"],
                "Preserve the changed original source: " + row["path"])
        all_after = False
    driver, metadata = read_regular(DRIVER)
    original = selection["originalDriver"]
    is_after = blob(driver) == DRIVER_BLOB
    require(is_after or match(driver, original),
            "Preserve the existing original customer caller")
    require(stat.S_IMODE(metadata.st_mode) == 0o600,
            "Keep the private original customer caller mode")
    if is_after:
        selected_bytes, _ = read_regular(SOURCE / "sdk-receiving-source.json")
        require(blob(selected_bytes) == SELECTION_BLOB,
                "Retain the full source selection used by the adopted caller")
    return all_after and is_after


def original_request(native, expected_sha256=None):
    raw, _ = read_regular(RECORD / "request.json")
    request = json.loads(raw)
    intent = request["intent"]
    require(request.get("schema") == native.SCHEMA and
            native.run_path(OPERATION, RECORD.parent) == RECORD and
            intent["operation_id"] == OPERATION and intent["project"] == str(PROJECT) and
            intent["command"] == [NODE, str(DRIVER)],
            "Preserve the original 43c request, command and project")
    if expected_sha256 is not None:
        require(digest(raw) == expected_sha256, "Preserve the exact selected original native request")
    retained = ADOPTION / "original-request.json"
    if os.path.lexists(retained):
        saved, _ = read_regular(retained)
        require(saved == raw, "The original native request changed after source adoption began")
    return raw


def dispatched_or_owned(native):
    state = native.read_json(RECORD / "state.json") or {}
    return bool(native.alive(state.get("supervisor")) or native.alive(state.get("process")) or
                state.get("process") or any((RECORD / name).exists() for name in
                ("process.json", "output.log", "command-completion.dat",
                 "result.json", "stop-request.json")))


def prepare(payload, expected_request_sha256=None):
    sys.dont_write_bytecode = True
    require(HOST.resolve(strict=True).is_dir(), "Use the existing complete maintained native host")
    sys.path.insert(0, str(HOST))
    import native_foreground as foreground
    native = foreground.load_native(str(HOST))
    import native_runtime_handoff as handoff
    for module in (native, foreground, handoff):
        require(Path(module.__file__).resolve().parent == HOST.resolve(strict=True),
                "Use the complete selected native host as one source closure")
    runtime = handoff.runtime_identity(native)
    require(runtime["sha256"] == HOST_SHA256, "Preserve the selected complete 82-file native host")
    selection, selection_bytes, driver_bytes, files = selection_payload(payload)
    with native.run_lock(RECORD):
        request_bytes = original_request(native, expected_request_sha256)
        already = check_sources(selection)
        if dispatched_or_owned(native):
            require(already, "Follow the original native owner before changing its selected source")
            return {"schema": SCHEMA, "state": "ADOPTED_SOURCE_ORIGINAL_OWNER",
                    "operationId": OPERATION, "record": str(RECORD),
                    "requestSha256": digest(request_bytes), "sourceSelectionBlob": SELECTION_BLOB,
                    "driverBlob": DRIVER_BLOB, "files": 341,
                    "native": native.report_value(native.inspect(RECORD), "summary")}
        directory(ADOPTION)
        retain(ADOPTION / "original-request.json", request_bytes)
        retain(ADOPTION / "source-selection.json", selection_bytes)
        driver_backup = ADOPTION / "preimages" / "feed-mcp-native-journey.mjs"
        current_driver, _ = read_regular(DRIVER)
        if match(current_driver, selection["originalDriver"]):
            retain(driver_backup, current_driver)
        else:
            original_driver, _ = read_regular(driver_backup)
            require(match(original_driver, selection["originalDriver"]),
                    "Retain the original customer caller before reopening adoption")
        # New imports exist before their consumers change. Replaced bytes are
        # retained before publication; the existing native command is untouched.
        for row in selection["overlay"]:
            if row["before"] is None:
                retain(source_path(row["path"]), files[row["path"]][1], row["mode"])
        for row in selection["overlay"]:
            if row["before"] is not None:
                replace_original(source_path(row["path"]), files[row["path"]][1],
                                 row["before"], ADOPTION / "preimages" / row["path"],
                                 row["mode"])
        retain(SOURCE / "sdk-receiving-source.json", selection_bytes)
        # Keep the same request and original driver until its complete source
        # has been written and independently read back in this locked scope.
        for row in selection["files"]:
            actual, _ = read_regular(source_path(row["path"]))
            require(match(actual, row), "Selected source did not read back: " + row["path"])
        require(original_request(native, digest(request_bytes)) == request_bytes,
                "Preserve the original native request throughout publication")
        require(not dispatched_or_owned(native), "Retain the original undispatched native scope")
        replace_original(DRIVER, driver_bytes, selection["originalDriver"], driver_backup)
        require(check_sources(selection), "Read back the complete original adopted customer source")
        receipt = {"schema": SCHEMA, "state": "ADOPTED", "operationId": OPERATION,
                   "record": str(RECORD), "requestSha256": digest(request_bytes),
                   "requestBytes": len(request_bytes), "project": str(PROJECT),
                   "sourceRoot": str(SOURCE), "sourceSelectionBlob": SELECTION_BLOB,
                   "originalInventoryBlob": selection["originalInventory"]["sha"],
                   "originalDriverBlob": selection["originalDriver"]["sha"],
                   "driverBlob": DRIVER_BLOB, "sdkSourceCommit": selection["sdkSourceCommit"],
                   "sourceFiles": 341, "sourceBytes": selection["bytes"],
                   "updatedFiles": 5, "addedFiles": 12,
                   "dependencyTarget": selection["dependency"]["target"],
                   "adoptionDirectory": str(ADOPTION), "runtimeSha256": HOST_SHA256}
        retain(ADOPTION / "adopted.json", encoded(receipt))
        return receipt
