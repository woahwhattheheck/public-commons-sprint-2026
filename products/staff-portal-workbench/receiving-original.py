#!/usr/bin/env python3
"""Source-bound offline intake and complete receiving for the staff portal.

This helper imports the selected original implementation after verifying every
private source member. It never contacts a tenant or performs a native migration.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
import copy
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import sys
import zipfile

SCHEMA = "stellar-forge.staff-portal-original-receiving.v1"
SOURCE_SCHEMA = "stellar-forge.staff-portal-workbench-source.v1"
SHA = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}\Z")
MAX_JSON = 32 * 1024 * 1024
MAX_ARCHIVE = 8 * 1024 * 1024 * 1024

def need(value, message):
    if not value:
        raise ValueError(message)

def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def digest_bytes(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

def read_json(path):
    path = regular(path)
    need(path.stat().st_size <= MAX_JSON, "JSON selection exceeds 32 MiB")
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result, "Duplicate JSON member: " + key)
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON: " + value)))

def regular(value):
    path = Path(value)
    need(path.is_absolute(), "Use an absolute selected file path")
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "Select an ordinary file: " + str(path))
    need(path.resolve() == path, "Select the canonical ordinary file path: " + str(path))
    return path

def directory(value, create=False, private=True):
    path = Path(value)
    need(path.is_absolute(), "Use an absolute directory")
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path, "Select a canonical ordinary directory")
    if private:
        need(info.st_uid == os.geteuid() and not (info.st_mode & 0o077), "Use an owned private receiving directory")
    return path

def relative(value):
    need(isinstance(value, str) and value and "\\" not in value and "\x00" not in value,
         "Invalid relative member")
    parts = value.split("/")
    need(not value.startswith("/") and all(p not in ("", ".", "..") for p in parts),
         "Unsafe relative member: " + value)
    return value

def identity(path):
    path = regular(path)
    before = path.stat()
    check = hashlib.sha256()
    count = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1048576), b""):
            count += len(block)
            check.update(block)
    after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and count == after.st_size,
         "Selected file changed while reading")
    return {"path": str(path), "bytes": count, "sha256": check.hexdigest()}

def descriptor(value):
    need(isinstance(value, dict) and isinstance(value.get("bytes"), int)
         and not isinstance(value["bytes"], bool) and value["bytes"] >= 0
         and isinstance(value.get("sha256"), str) and SHA.fullmatch(value["sha256"]),
         "Invalid selected file descriptor")
    actual = identity(value["path"])
    need(actual["bytes"] == value["bytes"] and actual["sha256"] == value["sha256"],
         "Selected file bytes changed: " + str(value["path"]))
    return actual

def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def keep_bytes(path, raw):
    path = Path(path)
    directory(str(path.parent), create=True)
    if path.exists():
        need(regular(path).read_bytes() == raw, "Immutable output differs: " + str(path))
        return identity(path)
    temporary = path.with_name(path.name + "." + secrets.token_hex(12) + ".writing")
    with temporary.open("xb") as output:
        os.chmod(temporary, 0o600)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    try:
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(regular(path).read_bytes() == raw, "Concurrent immutable output differs")
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
    return identity(path)

def keep_json(path, value):
    return keep_bytes(path, canonical(value))

def copy_exact(source, destination, expected=None):
    source = regular(source)
    chosen = identity(source)
    if expected is not None:
        need(chosen["bytes"] == expected["bytes"] and chosen["sha256"] == expected["sha256"],
             "Copy source differs from the selected bytes")
    destination = Path(destination)
    directory(str(destination.parent), create=True)
    if destination.exists():
        observed = identity(destination)
        need(all(observed[key] == chosen[key] for key in ("bytes", "sha256")), "Closed copied output differs")
        return observed
    temporary = destination.with_name(destination.name + "." + secrets.token_hex(12) + ".writing")
    with source.open("rb") as incoming, temporary.open("xb") as output:
        os.chmod(temporary, 0o600)
        shutil.copyfileobj(incoming, output, 1048576)
        output.flush()
        os.fsync(output.fileno())
    actual = identity(temporary)
    need(all(actual[key] == chosen[key] for key in ("bytes", "sha256")), "Copy changed")
    try:
        try:
            os.link(temporary, destination)
        except FileExistsError:
            observed = identity(destination)
            need(all(observed[key] == chosen[key] for key in ("bytes", "sha256")), "Closed copy collision")
        fsync_directory(destination.parent)
    finally:
        temporary.unlink(missing_ok=True)
    return identity(destination)

@contextlib.contextmanager
def lock(path):
    path = Path(path)
    directory(str(path.parent), create=True)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
             and not (info.st_mode & 0o077), "Unsafe operation lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        selected = path.lstat()
        need(path.resolve() == path and not path.is_symlink()
             and (selected.st_dev, selected.st_ino) == (info.st_dev, info.st_ino),
             "The selected original operation lock was replaced")
        yield fd
    finally:
        os.close(fd)

def source_selection(request):
    root = directory(request["applicationDirectory"], private=False)
    manifest_path = regular(request["sourceManifestFile"])
    need(identity(manifest_path)["sha256"] == request["sourceManifestSha256"],
         "Original source manifest changed")
    manifest = read_json(manifest_path)
    need(manifest.get("schema") == SOURCE_SCHEMA and isinstance(manifest.get("files"), list)
         and 0 < len(manifest["files"]) <= 25000, "Invalid original source manifest")
    rows = {}
    total = 0
    for row in manifest["files"]:
        name = relative(row["path"])
        need(name not in rows and name.casefold() not in {x.casefold() for x in rows},
             "Duplicate original source name")
        expected = {"path": str(root / name), "bytes": row["bytes"], "sha256": row["sha256"]}
        descriptor(expected)
        rows[name] = {"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}
        total += row["bytes"]
    need(total <= MAX_JSON, "Selected original source exceeds 32 MiB")
    observed = set()
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            child = Path(base) / name
            need(not child.is_symlink(), "Source directory symlink is not allowed")
            if name == "__pycache__":
                dirs.remove(name)
        for name in files:
            child = Path(base) / name
            need(child.is_file() and not child.is_symlink(), "Source contains a non-ordinary file")
            observed.add(child.relative_to(root).as_posix())
    need(observed == set(rows), "Selected source is not the complete declared original tree")
    sys.path.insert(0, str(root))
    engine = importlib.import_module("engine")
    delivery = importlib.import_module("portal_delivery")
    original_store = importlib.import_module("store")
    workspace = importlib.import_module("portal_workspace")
    need(set(delivery.SOURCE_FILES) == set(rows), "Manifest and original delivery source population differ")
    for module in (engine, delivery, original_store, workspace):
        actual = Path(module.__file__).resolve()
        name = actual.relative_to(root).as_posix()
        need(name in rows and identity(actual)["sha256"] == rows[name]["sha256"], "Loaded original module differs")
    # Bind every source-owned import already loaded, including nested readers.
    for module in tuple(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if not filename:
            continue
        actual = Path(filename).resolve()
        try:
            name = actual.relative_to(root).as_posix()
        except ValueError:
            continue
        need(name in rows and identity(actual)["sha256"] == rows[name]["sha256"],
             "An executing source dependency is outside the selection: " + name)
    return root, rows, engine, delivery, original_store, workspace

def archive_inventory(path):
    path = regular(path)
    need(path.stat().st_size <= MAX_ARCHIVE, "Archive exceeds selected reader capacity")
    rows = []
    seen = set()
    total = 0
    with zipfile.ZipFile(path) as archive:
        need(len(archive.infolist()) <= 100000, "Archive has too many members")
        for info in archive.infolist():
            name = info.filename.rstrip("/") if info.is_dir() else info.filename
            relative(name)
            need(name.casefold() not in seen, "Duplicate archive member")
            seen.add(name.casefold())
            mode = info.external_attr >> 16
            need(not stat.S_ISLNK(mode) and stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR),
                 "Archive contains a special file")
            if info.is_dir():
                continue
            total += info.file_size
            need(total <= MAX_ARCHIVE and info.file_size <= MAX_ARCHIVE, "Expanded archive exceeds capacity")
            check = hashlib.sha256()
            count = 0
            with archive.open(info) as incoming:
                for block in iter(lambda: incoming.read(1048576), b""):
                    check.update(block)
                    count += len(block)
            need(count == info.file_size, "Truncated ZIP member")
            rows.append({"path": info.filename, "bytes": count, "sha256": check.hexdigest()})
    return rows

def extract_member(archive_path, member, destination, expected=None):
    relative(member)
    destination = Path(destination)
    if destination.exists():
        actual = identity(destination)
        if expected:
            need(all(actual[k] == expected[k] for k in ("bytes", "sha256")), "Retained extracted member differs")
        else:
            with zipfile.ZipFile(archive_path) as archive:
                raw = archive.read(member)
            need(digest_bytes(raw) == {k: actual[k] for k in ("bytes", "sha256")}, "Retained extracted member changed")
        return actual
    directory(str(destination.parent), create=True)
    temporary = destination.with_name(destination.name + "." + secrets.token_hex(12) + ".writing")
    with zipfile.ZipFile(archive_path) as archive, archive.open(member) as incoming, temporary.open("xb") as output:
        os.chmod(temporary, 0o600)
        shutil.copyfileobj(incoming, output, 1048576)
        output.flush()
        os.fsync(output.fileno())
    actual = identity(temporary)
    if expected:
        need(all(actual[k] == expected[k] for k in ("bytes", "sha256")), "Extracted member differs")
    try:
        result = copy_exact(temporary, destination, actual)
    finally:
        temporary.unlink(missing_ok=True)
    return result

def check_delivery(path, rows, output, delivery, original_store, workspace):
    checked = delivery.inspect(str(path))
    manifest = checked["manifest"]
    selected = {name: {"bytes": row["bytes"], "sha256": row["sha256"]} for name, row in rows.items()}
    actual = {row["path"][7:]: {"bytes": row["bytes"], "sha256": row["sha256"]}
              for row in manifest["files"] if row["path"].startswith("source/")}
    need(actual == selected, "Delivery has another source selection")
    inner_descriptor = next(row for row in manifest["files"] if row["path"] == "workspace.zip")
    inner = extract_member(path, "workspace.zip", Path(output) / ("workspace-" + inner_descriptor["sha256"] + ".zip"), inner_descriptor)
    native = original_store.check_workspace_archive(inner["path"])
    workspace.validate_received(native, inner["path"])
    meta = native["data"]["workspace.json"]
    need(meta["id"] == manifest["workspaceId"] and meta["revision"] == manifest["revision"],
         "Delivery and original workspace selection differ")
    return checked, native, inner

def counts(data):
    state = data["state.json"]
    result = {"history": len(data["history.json"]), "requests": len(data["requests.json"]),
              "uploads": len(data["uploads.json"]), "objects": len(data["objects.json"]),
              "sources": len(state.get("sources", []))}
    for name in ("portal", "thoughtfarmerInsights", "thoughtfarmerEditorial"):
        domain = state.get(name)
        result[name] = {"present": isinstance(domain, dict),
                        "collections": {key: len(value) for key, value in (domain or {}).items()
                                        if isinstance(value, (dict, list))}}
    return result

def finish(stage, request, value, artifacts):
    result = {"schema": "stellar-forge.staff-portal-original-result.v1",
              "requestSha256": digest_bytes(canonical(request))["sha256"],
              "action": request["action"], "id": request["id"],
              "value": value, "artifacts": artifacts}
    keep_json(stage / "candidate.json", result)
    return reopen_candidate(stage, request)

def reopen_candidate(stage, request):
    candidate = stage / "candidate.json"
    result_path = stage / "result.json"
    if not candidate.exists():
        need(not result_path.exists(), "Result has no retained candidate")
        return None
    result = read_json(candidate)
    need(result.get("schema") == "stellar-forge.staff-portal-original-result.v1"
         and result.get("requestSha256") == digest_bytes(canonical(request))["sha256"]
         and result.get("action") == request["action"] and result.get("id") == request["id"],
         "Completed helper selection differs")
    for row in result["artifacts"]:
        descriptor(row)
    keep_json(result_path, result)
    return {**result, "resultFile": identity(result_path)}

def snapshot(workspace, stage, selected, original_store, original_workspace):
    path = stage / "workspace.zip"
    if not path.exists():
        produced, _ = workspace.make_workspace_zip()
        try:
            copy_exact(Path(produced).resolve(), path)
        finally:
            Path(produced).unlink(missing_ok=True)
    checked = original_store.check_workspace_archive(str(path))
    original_workspace.validate_received(checked, str(path))
    meta = checked["data"]["workspace.json"]
    need(meta["id"] == selected["workspaceId"] and meta["revision"] == selected["revision"],
         "Workspace snapshot is not the selected original revision")
    data_file = keep_json(stage / "snapshot.json", checked["data"])
    return checked, identity(path), data_file

def ensure_prefix(before, after, local_edit=None):
    old, new = copy.deepcopy(before["state.json"]), copy.deepcopy(after["state.json"])
    if local_edit is not None:
        need(new["project"]["notes"] == local_edit, "The selected local notes were not saved")
        new["project"]["notes"] = old["project"]["notes"]
    need(old == new, "Original complete saved domains changed outside the selected local edit")
    need(after["history.json"][:len(before["history.json"])] == before["history.json"], "Original full history prefix changed")
    for name, key in (("requests.json", "id"), ("uploads.json", "id"), ("objects.json", "sha256")):
        newer = {row[key]: row for row in after[name]}
        need(len(newer) == len(after[name]), "Duplicate retained identity")
        for row in before[name]:
            need(newer.get(row[key]) == row, "An original retained row changed: " + name)

def inspect_original(request, stage, rows, engine, delivery, original_store, workspace):
    chosen = request["donor"]
    archive = descriptor(chosen["archive"])
    operating = descriptor(chosen["delivery"])
    roster = archive_inventory(archive["path"])
    by_name = {row["path"]: row for row in roster}
    roster_file = keep_json(stage / "donor-members.json", roster)
    matches = []
    with zipfile.ZipFile(archive["path"]) as zipped:
        for row in roster:
            if row["path"].endswith(".json") and row["bytes"] <= MAX_JSON:
                try:
                    body = engine.exact_json(zipped.read(row["path"]))
                except (ValueError, UnicodeError, engine.Problem):
                    continue
                if isinstance(body, dict) and body.get("schema") == chosen["resultSchema"] and body.get("operationId") == chosen["operationId"] and body.get("status") == chosen["resultStatus"]:
                    matches.append((row["path"], body))
        if chosen.get("resultMember"):
            matches = [pair for pair in matches if pair[0] == chosen["resultMember"]]
        need(len(matches) == 1, "Select the one complete original result member")
        result_name, result = matches[0]
        prefix = str(PurePosixPath(result_name).parent)
        prefix = "" if prefix == "." else prefix + "/"
        source_hashes = {name: row["sha256"] for name, row in rows.items()}
        need(result["sourceSha256"] == engine.digest(source_hashes)
             and result["sourceFiles"] == len(rows), "Original completion names another complete source")
        need(result["selectedWorkspaceId"] == chosen["selectedWorkspaceId"]
             and result["selectedRevision"] == chosen["selectedRevision"], "Original completed workspace selection differs")
        if chosen.get("receivedWorkspaceId"):
            need(result["receivedWorkspaceId"] == chosen["receivedWorkspaceId"], "Original cold receiver differs")
        original_input_name = prefix + "original-input.json"
        need(original_input_name in by_name, "Complete original request is absent")
        original_input = engine.exact_json(zipped.read(original_input_name))
        need(result["inputSha256"] == engine.digest(original_input)
             and original_input.get("operationId") == chosen["operationId"], "Original request/result binding differs")
        declared_outputs = []
        for row in result["files"]:
            name = prefix + relative(row["path"])
            need(name in by_name and all(by_name[name][key] == row[key] for key in ("bytes", "sha256")),
                 "An original completed output is absent or changed")
            declared_outputs.append(name)
        need(any(by_name[name]["sha256"] == operating["sha256"] and by_name[name]["bytes"] == operating["bytes"]
                 for name in declared_outputs), "Selected operating archive was not an original completed output")
        first = next(iter(rows))
        suffix = "source/" + first
        possible = [row["path"][:-len(suffix)] for row in roster if row["path"].endswith(suffix)]
        source_prefixes = [base + "source/" for base in possible if all(
            base + "source/" + name in by_name and
            all(by_name[base + "source/" + name][key] == selected[key] for key in ("bytes", "sha256"))
            for name, selected in rows.items())]
        need(source_prefixes, "Complete original source is absent from the retained handover")
        native_result_file = keep_bytes(stage / "original-result.json", zipped.read(result_name))
        original_input_file = keep_bytes(stage / "original-input.json", zipped.read(original_input_name))
    checked, native, inner = check_delivery(operating["path"], rows, stage, delivery, original_store, workspace)
    meta = native["data"]["workspace.json"]
    need(meta["id"] == result["selectedWorkspaceId"] and meta["revision"] == result["selectedRevision"],
         "Operating handover and original result select different workspaces")
    objects = {row["sha256"]: row for row in native["data"]["objects.json"]}
    custody = result.get("originalArchiveCustody")
    need(isinstance(custody, dict) and custody, "Original archive custody is missing")
    need(set(custody) == {row["name"] for row in original_input["imports"]}, "Original imported archive population differs")
    for item in original_input["imports"]:
        held = custody[item["name"]]["object"]
        need(held["sha256"] == item["sha256"] and held["bytes"] == item["bytes"]
             and held["sha256"] in objects and objects[held["sha256"]]["bytes"] == held["bytes"],
             "A complete earlier original archive is absent from the selected handover")
    need(all(native["data"]["state.json"].get(key) is not None
             for key in ("portal", "thoughtfarmerInsights", "thoughtfarmerEditorial")),
         "All original saved domains must be present")
    snapshot_file = keep_json(stage / "snapshot.json", native["data"])
    copied_archive = copy_exact(archive["path"], stage / "original-handover.zip", archive)
    copied_delivery = copy_exact(operating["path"], stage / "original-operating.zip", operating)
    return finish(stage, request, {"result": result, "resultMember": result_name,
        "sourcePrefixes": source_prefixes, "counts": counts(native["data"]),
        "workspace": meta, "delivery": checked, "snapshot": snapshot_file},
        [roster_file, native_result_file, original_input_file, snapshot_file, inner, copied_archive, copied_delivery])

def operate(request, stage, rows, engine, delivery, original_store, original_workspace):
    action = request["action"]
    if action == "inspect-original":
        return inspect_original(request, stage, rows, engine, delivery, original_store, original_workspace)
    if action == "inspect-delivery":
        selected = descriptor(request["delivery"])
        checked, native, inner = check_delivery(selected["path"], rows, stage, delivery, original_store, original_workspace)
        need(checked["manifest"]["workspaceId"] == request["workspaceId"]
             and checked["manifest"]["revision"] == request["revision"],
             "Downloaded operating package does not match the selected workspace edition")
        snapshot_file = keep_json(stage / "snapshot.json", native["data"])
        return finish(stage, request, {"delivery": {**selected, "manifest": checked["manifest"]},
             "snapshot": snapshot_file, "counts": counts(native["data"])},
             [selected, inner, snapshot_file])
    if action == "bundle":
        selected = request["files"]
        need(isinstance(selected, list) and selected, "Select the complete outgoing artifact population")
        names = set()
        for row in selected:
            name = relative(row["name"])
            need(name != "HANDOVER-MANIFEST.json" and name not in names, "Duplicate outgoing artifact name")
            names.add(name)
            descriptor(row)
        manifest = {"schema": "stellar-forge.staff-portal-installed-handover.v1",
                    "files": [{"path": row["name"], "bytes": row["bytes"], "sha256": row["sha256"]} for row in selected]}
        output = stage / "installed-handover.zip"
        def validate_archive(path):
            roster = archive_inventory(str(path))
            expected = {row["path"]: row for row in manifest["files"]}
            expected["HANDOVER-MANIFEST.json"] = {"path": "HANDOVER-MANIFEST.json", **digest_bytes(canonical(manifest))}
            need({row["path"] for row in roster} == set(expected), "Outgoing handover population differs")
            for row in roster:
                need(all(row[key] == expected[row["path"]][key] for key in ("bytes", "sha256")),
                     "Outgoing handover member differs")
            with zipfile.ZipFile(path) as archive:
                need(archive.read("HANDOVER-MANIFEST.json") == canonical(manifest), "Outgoing complete manifest differs")
        if not output.exists():
            temporary = stage / "installed-handover.candidate.zip"
            if temporary.exists():
                try:
                    validate_archive(temporary)
                except (ValueError, zipfile.BadZipFile, EOFError):
                    preserved = temporary.with_name(temporary.name + "." + secrets.token_hex(8) + ".interrupted")
                    os.rename(temporary, preserved)
                    fsync_directory(stage)
            if not temporary.exists():
                with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    os.chmod(temporary, 0o600)
                    for row in selected:
                        descriptor(row)
                        member = zipfile.ZipInfo(row["name"], (1980, 1, 1, 0, 0, 0))
                        member.external_attr = (stat.S_IFREG | 0o600) << 16
                        member.compress_type = zipfile.ZIP_DEFLATED
                        with archive.open(member, "w", force_zip64=True) as outgoing, regular(row["path"]).open("rb") as incoming:
                            shutil.copyfileobj(incoming, outgoing, 1048576)
                        descriptor(row)
                    member = zipfile.ZipInfo("HANDOVER-MANIFEST.json", (1980, 1, 1, 0, 0, 0))
                    member.external_attr = (stat.S_IFREG | 0o600) << 16
                    member.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(member, canonical(manifest))
                with temporary.open("rb") as retained:
                    os.fsync(retained.fileno())
                fsync_directory(stage)
            validate_archive(temporary)
            os.link(temporary, output)
            fsync_directory(stage)
            temporary.unlink()
            fsync_directory(stage)
        validate_archive(output)
        manifest_file = keep_json(stage / "handover-manifest.json", manifest)
        return finish(stage, request, {"archive": identity(output), "manifest": manifest_file, "members": len(manifest["files"]) + 1},
                      [identity(output), manifest_file])
    if action == "compare":
        before = read_json(descriptor(request["before"])["path"])
        after = read_json(descriptor(request["after"])["path"])
        ensure_prefix(before, after, request.get("notes"))
        return finish(stage, request, {"unchangedOriginalState": True,
             "before": counts(before), "after": counts(after),
             "beforeWorkspace": before["workspace.json"], "afterWorkspace": after["workspace.json"]},
             [descriptor(request["before"]), descriptor(request["after"])])
    root = directory(request["directory"], create=True)
    # Same lock as the original server and CLI wrapper; no second live writer.
    with lock(root / "portal-operator.lock"):
        if action not in ("receive",):
            need((root / "registry.sqlite3").is_file(), "Selected original registry is absent")
        manager = original_workspace.open_manager(root)
        if action == "receive":
            selected_delivery = descriptor(request["delivery"])
            _, native, inner = check_delivery(selected_delivery["path"], rows, stage, delivery, original_store, original_workspace)
            selection_path = stage / "origin.json"
            if selection_path.exists():
                origin = read_json(selection_path)
            else:
                initial_id = request.get("originWorkspaceId") or manager.list()[0]["id"]
                manager.get(initial_id)
                origin = {"workspaceId": initial_id}
                keep_json(selection_path, origin)
            if request.get("originWorkspaceId"):
                need(origin["workspaceId"] == request["originWorkspaceId"], "Original receiving origin changed")
            received = delivery.receive(manager, origin["workspaceId"], selected_delivery["path"],
                                        request["requestId"], request["actor"])
            repeated = delivery.receive(manager, origin["workspaceId"], selected_delivery["path"],
                                        request["requestId"], request["actor"])
            need(repeated == received, "Original receiving receipt did not replay exactly")
            receipt_file = keep_json(stage / "original-receipt.json", received)
            target = manager.get(received["workspaceId"])
            current = target.meta()
            first = received["result"]["state"]["workspace"]
            need(current["id"] == first["id"] and current.get("origin") == first.get("origin"),
                 "Received workspace no longer belongs to the original request")
            # First-step completion precedes every later edit in the course. If
            # it is interrupted, original manager replay recovers the same ID.
            need(current["revision"] == received["revision"], "Receiving continued into later edits before its snapshot was retained")
            checked, archive_file, snapshot_file = snapshot(target, stage,
                {"workspaceId": received["workspaceId"], "revision": received["revision"]},
                original_store, original_workspace)
            ensure_prefix(native["data"], checked["data"])
            return finish(stage, request, {"receiving": received, "workspace": current,
                 "counts": counts(checked["data"]), "snapshot": snapshot_file},
                 [receipt_file, inner, archive_file, snapshot_file, identity(selection_path), selected_delivery])
        if action == "replay-receive":
            saved = read_json(descriptor(request["receipt"])["path"])
            selected_delivery = descriptor(request["delivery"])
            target = manager.get(saved["workspaceId"])
            before_meta = target.meta()
            need(before_meta["revision"] == request["revision"], "Select the actual later received revision")
            returned = delivery.receive(manager, request["originWorkspaceId"], selected_delivery["path"],
                                        request["requestId"], request["actor"])
            need(returned == saved and target.meta() == before_meta,
                 "Original receiving replay changed its receipt or later workspace")
            checked, archive_file, snapshot_file = snapshot(target, stage,
                {"workspaceId": saved["workspaceId"], "revision": request["revision"]},
                original_store, original_workspace)
            return finish(stage, request, {"receiving": returned, "workspace": before_meta,
                 "counts": counts(checked["data"]), "snapshot": snapshot_file},
                 [descriptor(request["receipt"]), selected_delivery, archive_file, snapshot_file])
        target = manager.get(request["workspaceId"])
        expected = {"workspaceId": request["workspaceId"], "revision": request["revision"]}
        if action == "audit":
            closed_snapshot = stage / "workspace.zip"
            if not closed_snapshot.exists():
                need(target.meta()["revision"] == request["revision"], "Current workspace differs from selected audit revision")
            checked, archive_file, snapshot_file = snapshot(target, stage, expected, original_store, original_workspace)
            return finish(stage, request, {"workspace": checked["data"]["workspace.json"],
                  "counts": counts(checked["data"]), "snapshot": snapshot_file},
                  [archive_file, snapshot_file])
        if action == "export":
            output = stage / "operating.zip"
            if not output.exists():
                need(target.meta()["revision"] == request["revision"], "Current workspace differs from selected export revision")
                produced, _ = delivery.package(target)
                try:
                    copy_exact(Path(produced).resolve(), output)
                finally:
                    Path(produced).unlink(missing_ok=True)
            checked, native, inner = check_delivery(output, rows, stage, delivery, original_store, original_workspace)
            need(checked["manifest"]["workspaceId"] == expected["workspaceId"]
                 and checked["manifest"]["revision"] == expected["revision"], "Closed operating export differs from selection")
            snapshot_file = keep_json(stage / "snapshot.json", native["data"])
            return finish(stage, request, {"delivery": {**identity(output), "manifest": checked["manifest"]},
                 "snapshot": snapshot_file, "counts": counts(native["data"])},
                 [identity(output), inner, snapshot_file])
        raise ValueError("Unknown original helper action")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args(argv)
    selection = read_json(args.selection)
    need(selection.get("schema") == SCHEMA, "Select the original receiving source contract")
    root = directory(args.directory, create=True)
    request = read_json(args.request)
    need(isinstance(request.get("id"), str) and IDENTIFIER.fullmatch(request["id"]), "Invalid immutable helper step ID")
    need(request.get("action") in ("inspect-original", "inspect-delivery", "receive", "replay-receive", "audit", "export", "compare", "bundle"), "Unsupported helper action")
    with lock(root / "helper.lock"):
        keep_json(root / "source-selection.json", selection)
        _, rows, engine, delivery, original_store, original_workspace = source_selection(selection)
        stage = directory(str(root / "steps" / request["id"]), create=True)
        keep_json(stage / "request.json", request)
        result = reopen_candidate(stage, request)
        if result is None:
            result = operate(request, stage, rows, engine, delivery, original_store, original_workspace)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        return result

if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        print(json.dumps({"ok": False, "error": {"type": type(error).__name__, "message": str(error)}}),
              file=sys.stderr, flush=True)
        raise SystemExit(1)
