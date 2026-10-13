#!/usr/bin/env python3
"""Full original catalogue, implementation and native approval receiving.

Imports only the selected private source. All offline reads and archive receiving
use the original Store, Implementation and ApprovalStore under the host lease.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
import copy
import fcntl
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import sys
import zipfile

SCHEMA = "stellar-forge.catalogue-delivery-original-receiving.v1"
SOURCE_SCHEMA = "stellar-forge.catalogue-delivery-workbench-source.v1"
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
    need(identity(manifest_path)["sha256"] == request["sourceManifestSha256"], "Original source manifest changed")
    manifest = read_json(manifest_path)
    need(manifest.get("schema") == SOURCE_SCHEMA and isinstance(manifest.get("files"), list)
         and 0 < len(manifest["files"]) <= 25000, "Invalid original source manifest")
    rows, total = {}, 0
    for row in manifest["files"]:
        name = relative(row["path"])
        need(name not in rows and name.casefold() not in {x.casefold() for x in rows}, "Duplicate source path")
        descriptor({"path": str(root / name), "bytes": row["bytes"], "sha256": row["sha256"]})
        rows[name] = {"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}
        total += row["bytes"]
    need(total <= MAX_JSON, "Complete source exceeds 32 MiB")
    actual = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            need(not (Path(parent) / name).is_symlink(), "Source directory symlink")
            if name == "__pycache__":
                dirs.remove(name)
        for name in files:
            item = regular(str(Path(parent) / name))
            actual.add(item.relative_to(root).as_posix())
    need(actual == set(rows), "Source tree differs from complete manifest")
    required = {"__init__.py", "delivery_store.py", "implementation.py", "approval_store.py",
                "approval_archive.py", "approval_receiving.py", "mcp.py", "web.py"}
    need(required <= set(rows), "Original catalogue module closure is incomplete")
    name = "_catalogue_original_" + request["sourceManifestSha256"][:24]
    spec = importlib.util.spec_from_file_location(name, root / "__init__.py", submodule_search_locations=[str(root)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    modules = {key: importlib.import_module(name + "." + key) for key in
               ("delivery_store", "implementation", "approval_store", "approval_archive", "mcp")}
    for key, module in tuple(sys.modules.items()):
        if not key.startswith(name + ".") and key != name:
            continue
        filename = Path(module.__file__).resolve()
        rel = filename.relative_to(root).as_posix()
        need(rel in rows and identity(filename)["sha256"] == rows[rel]["sha256"], "Loaded original module differs")
    return root, rows, modules

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

def finish(stage, request, value, artifacts):
    result = {"schema": "stellar-forge.catalogue-delivery-original-result.v1",
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
    need(result.get("schema") == "stellar-forge.catalogue-delivery-original-result.v1"
         and result.get("requestSha256") == digest_bytes(canonical(request))["sha256"]
         and result.get("action") == request["action"] and result.get("id") == request["id"],
         "Completed helper selection differs")
    for row in result["artifacts"]:
        descriptor(row)
    keep_json(result_path, result)
    return {**result, "resultFile": identity(result_path)}


def checked_archive(selected, manifest_name, schema):
    chosen = descriptor(selected)
    roster = archive_inventory(chosen["path"])
    mapping = {row["path"]: row for row in roster}
    need(manifest_name in mapping and mapping[manifest_name]["bytes"] <= MAX_JSON, "Archive manifest is absent or too large")
    with zipfile.ZipFile(chosen["path"]) as archive:
        raw = archive.read(manifest_name)
        manifest = json.loads(raw)
    need(manifest.get("schema") == schema and isinstance(manifest.get("files"), list), "Original archive schema differs")
    selected_rows = {}
    for row in manifest["files"]:
        name = relative(row["path"])
        need(name not in selected_rows and name in mapping, "Duplicate or absent archive declaration")
        need(type(row.get("bytes")) is int and row["bytes"] >= 0 and SHA.fullmatch(str(row.get("sha256", ""))),
             "Invalid original archive descriptor")
        need(all(row[key] == mapping[name][key] for key in ("bytes", "sha256")), "Original complete archive member differs")
        selected_rows[name] = row
    extras = {manifest_name}
    if schema == "catalogue-delivery.approval-export.v1":
        extras.add("README.txt")
    need(set(mapping) == set(selected_rows) | extras, "Archive contains unselected or omitted members")
    return chosen, manifest, selected_rows

def checked_implementation(selected, rows):
    chosen, manifest, mapping = checked_archive(selected, "MANIFEST.json", "catalogue-delivery.implementation-package.v1")
    prefix = "source/revenue/data_catalogue_delivery/"
    actual = {name[len(prefix):]: {"bytes": row["bytes"], "sha256": row["sha256"]}
              for name, row in mapping.items() if name.startswith(prefix)}
    expected = {name: {"bytes": row["bytes"], "sha256": row["sha256"]} for name, row in rows.items()
                if Path(name).suffix in (".py", ".mjs", ".html", ".css", ".md")}
    need(actual == expected, "Original implementation package source differs from selected executing source")
    return chosen, manifest, mapping

def original_environment(root):
    # Restored provider references and pending journals remain historical. This
    # independent offline workspace has no provider credentials or worker.
    return {"CATALOGUE_DELIVERY_LEASE_ROOT": str(root / "package-request-journal")}

def repair_interrupted_original_extraction(selected, mapping, destination, stage):
    # The unchanged reader writes each selected member to its final name. Recover
    # only an incomplete exact prefix, before any user/application edits begin.
    # Closed nonmatching files are conflicts and are never replaced.
    directory(str(destination), create=True)
    with zipfile.ZipFile(selected["path"]) as archive:
        for name, row in mapping.items():
            target = destination / name
            if not target.exists():
                continue
            current = identity(str(target))
            if all(current[k] == row[k] for k in ("bytes", "sha256")):
                continue
            need(current["bytes"] < row["bytes"], "Existing received member has different complete bytes: " + name)
            with target.open("rb") as retained, archive.open(name) as original:
                for part in iter(lambda: retained.read(1048576), b""):
                    need(original.read(len(part)) == part, "Existing receiving member is not the original partial prefix")
            record = {"member": name, "selected": row, "partial": current}
            ticket = hashlib.sha256(canonical(record)).hexdigest()
            saved = stage / "interrupted-extraction" / ticket
            directory(str(saved), create=True)
            keep_json(saved / "intent.json", record)
            retained = saved / "member.partial"
            if retained.exists():
                need(all(identity(str(retained))[k] == current[k] for k in ("bytes", "sha256")), "Interrupted member archive changed")
                target.unlink()
            else:
                os.rename(target, retained)
            fsync_directory(target.parent)
            fsync_directory(saved)

def receive_parts(request, stage, rows, modules):
    chosen, manifest, mapping = checked_implementation(request["implementationArchive"], rows)
    root = directory(str(stage / "inspected") if request["action"] == "inspect-original" else request["directory"], create=True)
    need(len(request["approvals"]) == 2, "Select the two original reviewed editions")
    source_ids, record_ids = set(), set()
    checked = []
    for item in request["approvals"]:
        archive, declared, members = checked_archive(item["archive"], "manifest.json", "catalogue-delivery.approval-export.v1")
        need(declared["record_id"] == item["recordId"] and declared["delivery_job_id"] == item["jobId"]
             and declared["source_id"] == item["sourceId"], "Selected approval edition differs")
        need(item["sourceId"] not in source_ids and item["recordId"] not in record_ids, "Select distinct source/review editions")
        source_ids.add(item["sourceId"]); record_ids.add(item["recordId"])
        checked.append((item, archive, declared, members))
    with lock(directory(str(root / "original-implementation" / "workspace"), create=True) / "catalogue-operator.lock"):
        destination = root / "original-implementation"
        repair_map = dict(mapping)
        with zipfile.ZipFile(chosen["path"]) as archive:
            raw = archive.read("MANIFEST.json")
        repair_map["MANIFEST.json"] = {"path": "MANIFEST.json", **digest_bytes(raw)}
        repair_interrupted_original_extraction(chosen, repair_map, destination, stage)
        received = modules["implementation"].receive_package(chosen["path"], str(destination))
        work = destination / "workspace"
        store = modules["delivery_store"].Store(work, environment=original_environment(work))
        implementation = modules["implementation"].Implementation(store)
        need(received["implementation"]["id"] == request["implementationId"]
             and received["implementation"]["revision"] == request["revision"], "Original implementation selection differs")
        # Restore both approval archives through their unchanged complete reader
        # before admitting their records into the received implementation.
        for number, (item, archive, declared, members) in enumerate(checked):
            restored = root / ("original-approval-" + str(number + 1))
            if not restored.exists():
                modules["approval_store"].ApprovalStore.restore(archive["path"], restored,
                                                               environment=original_environment(root))
            restored_store = modules["approval_store"].ApprovalStore(restored, environment=original_environment(root))
            graph = modules["approval_archive"].validate_record(restored_store, item["recordId"])
            for name, row in members.items():
                source = restored / name
                need(all(identity(str(source))[k] == row[k] for k in ("bytes", "sha256")), "Restored original approval differs")
                if name.startswith("approval/"):
                    copy_exact(source, work / name, row)
                else:
                    need((work / name).is_file(), "Implementation omitted an approval base graph member")
                    need(all(identity(str(work / name))[k] == row[k] for k in ("bytes", "sha256")),
                         "Original implementation and approval base graph disagree")
            source = graph["source"]
            need(source["id"] == item["sourceId"] and source["sha256"] == item["sha256"]
                 and source["bytes"] == item["bytes"] and source["row_count"] == item["rows"], "Complete source edition differs")
        state = snapshot(store, implementation, modules, stage)
        phases = validate_phases(request, state, modules)
        snapshot_file = keep_json(stage / "snapshot.json", state)
        return finish(stage, request, {"directory": str(root), "workspace": str(work),
            "implementationId": request["implementationId"], "revision": request["revision"],
            "workerStarted": False, "leaseRoot": original_environment(work)["CATALOGUE_DELIVERY_LEASE_ROOT"],
            "snapshot": snapshot_file, "nativePhases": phases},
            [chosen, *[a for _, a, _, _ in checked], snapshot_file,
             *[descriptor(item["phase"]) for item in request["approvals"]],
             *[descriptor(item["phaseArchive"]) for item in request["approvals"] if item.get("phaseArchive")]])

def snapshot(store, implementation, modules, stage):
    records = {name: {row["id"]: row for row in store._records(name)}
               for name in ("sources", "targets", "plans", "jobs", "feeds")}
    originals = {path.stem: implementation._load(path.stem) for path in sorted(implementation.root.glob("*.json"))}
    approval = modules["approval_store"].ApprovalStore(store)
    approvals = {name: {row["id"]: row for row in approval._all(name)}
                 for name in ("records", "profiles", "operations", "observations")}
    for record_id in approvals["records"]:
        modules["approval_archive"].validate_record(approval, record_id)
    objects, comparisons = {}, {}
    for source in records["sources"].values():
        path = store.source_path(source["id"])
        observed = identity(str(path))
        need(observed["sha256"] == source["sha256"] and observed["bytes"] == source["bytes"], "Retained CSV changed")
        objects[path.relative_to(store.root).as_posix()] = {k: observed[k] for k in ("bytes", "sha256")}
        for manifest in source["manifests"].values():
            path = store.root / "objects" / (manifest["sha256"] + ".json")
            observed = identity(str(path))
            need(observed["sha256"] == manifest["sha256"] and observed["bytes"] == manifest["bytes"], "Original producer manifest changed")
            objects[path.relative_to(store.root).as_posix()] = {k: observed[k] for k in ("bytes", "sha256")}
    for value in originals.values():
        for resource in value["profile"]["resources"]:
            for edition in resource["editions"]:
                modules["implementation"].source_index(store, edition["source_id"], resource["columns"], resource["identifier_columns"])
            comp = value["bindings"][resource["key"]]["comparison"]
            path = implementation.root / "comparisons" / comp["filename"]
            observed = identity(str(path))
            need(observed["sha256"] == comp["sha256"] and observed["bytes"] == comp["bytes"], "Full identifier comparison changed")
            comparisons[path.relative_to(store.root).as_posix()] = {k: observed[k] for k in ("bytes", "sha256")}
    return {"schema": "stellar-forge.catalogue-delivery-original-snapshot.v1",
            "workspace": read_json(str(store.root / "workspace.json")),
            "approvalWorkspace": read_json(str(approval.root / "workspace.json")),
            "records": records, "implementations": originals, "approval": approvals,
            "objects": objects, "comparisons": comparisons}

def validate_phases(request, state, modules):
    need(request.get("nativeOperationId") and isinstance(request["nativeOperationId"], str), "Retain the actual original native operation ID")
    implementation = state["implementations"][request["implementationId"]]
    bound = {step.get("job_id") for binding in implementation["bindings"].values() for step in binding["editions"]}
    output = []
    for number, item in enumerate(request["approvals"]):
        decision = ("reject", "approve")[number]
        need(item["decision"] == decision, "Preserve rejected initial and approved corrected edition ordering")
        source = state["records"]["sources"][item["sourceId"]]
        record = state["approval"]["records"][item["recordId"]]
        job = state["records"]["jobs"][item["jobId"]]
        need(job["id"] in bound and job["state"] == "DONE" and record["delivery_job_id"] == job["id"], "Approval is not the original implementation delivery")
        need(source["sha256"] == item["sha256"] and source["row_count"] == item["rows"] and source["bytes"] == item["bytes"], "Selected full edition differs")
        phase = read_json(descriptor(item["phase"])["path"])
        need(phase.get("schema") == "catalogue-delivery.approval-receiving.v1"
             and phase.get("decision") == decision and phase.get("native_state") == ("rejected" if number == 0 else "approved")
             and phase.get("private") is (number == 0)
             and phase.get("delivery_job_id") == item["jobId"] and phase.get("record_id") == item["recordId"]
             and phase.get("source") == record["source"], "Original native receiving result does not match the retained graph")
        profiles = phase.get("principal_ids", {})
        need(profiles.get("contributor") and profiles.get("reviewer") and profiles["contributor"] != profiles["reviewer"],
             "Native receiving requires distinct retained contributor and reviewer")
        operation_ids = phase.get("operation_ids")
        need(isinstance(operation_ids, list) and len(operation_ids) == 2 and len(set(operation_ids)) == 2, "Incomplete original native operation population")
        for index, operation_id in enumerate(operation_ids):
            need(operation_id in record["operation_ids"], "Native phase operation is absent from original review")
            operation = state["approval"]["operations"][operation_id]
            action = ("request", decision)[index]
            role = ("contributor", "reviewer")[index]
            need(operation["state"] == "APPLIED" and operation["request"]["action"] == action
                 and operation["principal_id"] == profiles[role], "Original native action or principal differs")
            applied = [row["result"] for row in operation["responses"] if row["result"].get("state") == "APPLIED"]
            events = phase.get("event_ids", {}).get(("request", "decision")[index])
            need(isinstance(events, list) and len(events) == 1 and applied
                 and applied[-1].get("matching_event_ids") == events, "Original native event evidence differs")
        original_archive = item.get("phaseArchive", item["archive"])
        need(all(phase.get("export", {}).get(k) == original_archive[k] for k in ("bytes", "sha256")),
             "Phase export and original approval archive differ")
        evidence, evidence_manifest, evidence_members = checked_archive(
            original_archive, "manifest.json", "catalogue-delivery.approval-export.v1")
        need(evidence_manifest["record_id"] == item["recordId"], "Native phase archive identifies another review")
        with zipfile.ZipFile(evidence["path"]) as archive:
            for collection in ("profiles", "operations", "observations"):
                for path in evidence_members:
                    prefix = "approval/" + collection + "/"
                    if path.startswith(prefix):
                        original = json.loads(archive.read(path))
                        need(state["approval"][collection][original["id"]] == original,
                             "Original native evidence was changed by receiving")
            original_record = json.loads(archive.read("approval/records/" + item["recordId"] + ".json"))
            for key in set(original_record) - {"notes", "notes_history", "revision", "updated_at"}:
                need(record.get(key) == original_record[key], "Original native review binding changed")
        output.append(phase)
    return output

def compare_snapshots(before, after, notes=None):
    for key in ("schema", "workspace", "approvalWorkspace", "records", "implementations", "objects", "comparisons"):
        need(before[key] == after[key], "Original catalogue state changed: " + key)
    for key in ("profiles", "operations", "observations"):
        need(before["approval"][key] == after["approval"][key], "Original native approval history changed")
    need(set(before["approval"]["records"]) == set(after["approval"]["records"]), "Approval record population changed")
    for record_id, value in before["approval"]["records"].items():
        current = after["approval"]["records"][record_id]
        if notes and record_id == notes["recordId"]:
            expected = copy.deepcopy(value)
            expected["notes"] = notes["text"]
            expected["revision"] = notes["revision"]
            expected["updated_at"] = current["updated_at"]
            delta = current["revision"] - value["revision"]
            history = current.get("notes_history")
            need(delta == 1 and isinstance(history, list)
                 and history[:-1] == value["notes_history"] and history[-1].get("notes") == notes["text"]
                 and isinstance(history[-1].get("saved_at"), str),
                 "Local notes must append exactly one original revision")
            expected["notes_history"] = history
            need(current == expected, "Only the exact selected local review note may change")
        else:
            need(current == value, "An unselected review record changed")

def export_closed(path, invoke, inspect):
    if path.exists():
        try:
            inspect(path)
        except (zipfile.BadZipFile, EOFError):
            os.rename(path, path.with_name(path.name + "." + secrets.token_hex(8) + ".interrupted"))
            fsync_directory(path.parent)
    if not path.exists():
        invoke(path)
        with path.open("rb") as incoming:
            os.fsync(incoming.fileno())
        fsync_directory(path.parent)
    inspect(path)
    return identity(str(path))

def operate(request, stage, rows, modules):
    action = request["action"]
    if action == "bundle":
        selected = request["files"]
        need(isinstance(selected, list) and selected, "Select the complete outgoing artifact population")
        names = set()
        for row in selected:
            name = relative(row["name"])
            need(name != "HANDOVER-MANIFEST.json" and name not in names, "Duplicate outgoing artifact name")
            names.add(name)
            descriptor(row)
        manifest = {"schema": "stellar-forge.catalogue-delivery-installed-handover.v1",
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
    if action in ("inspect-original", "receive"):
        return receive_parts(request, stage, rows, modules)
    if action == "compare":
        before = read_json(descriptor(request["before"])["path"])
        after = read_json(descriptor(request["after"])["path"])
        compare_snapshots(before, after, request.get("notes"))
        return finish(stage, request, {"unchangedOriginalHistory": True, "notes": request.get("notes"),
            "sourceRows": {key: value["row_count"] for key, value in after["records"]["sources"].items()}},
            [descriptor(request["before"]), descriptor(request["after"])])
    root = directory(request["directory"])
    with lock(directory(str(root / "original-implementation" / "workspace"), create=True) / "catalogue-operator.lock"):
        work = directory(str(root / "original-implementation" / "workspace"))
        store = modules["delivery_store"].Store(work, environment=original_environment(work))
        implementation = modules["implementation"].Implementation(store)
        observed = snapshot(store, implementation, modules, stage)
        if action == "audit":
            if request.get("expectedSnapshot"):
                original = read_json(descriptor(request["expectedSnapshot"])["path"])
                compare_snapshots(original, observed, request.get("notes"))
            saved = keep_json(stage / "snapshot.json", observed)
            return finish(stage, request, {"snapshot": saved,
                "implementationIds": sorted(observed["implementations"]),
                "approvalIds": sorted(observed["approval"]["records"]),
                "sources": list(observed["records"]["sources"].values())}, [saved])
        if action == "export":
            value = implementation._load(request["implementationId"])
            need(value["revision"] == request["revision"], "Export selection differs from the actual implementation revision")
            def inspect_implementation(path):
                _, meta, _ = checked_implementation(identity(str(path)), rows)
                need(meta["implementation_id"] == value["id"] and meta["revision"] == value["revision"], "Retained export is another revision")
            original = export_closed(stage / "implementation.zip",
                lambda path: implementation.export(value["id"], path, expected_revision=value["revision"]), inspect_implementation)
            approval = modules["approval_store"].ApprovalStore(store)
            exports = []
            need(len(request["approvalRecords"]) == 2 and len({x["recordId"] for x in request["approvalRecords"]}) == 2,
                 "Export both exact selected native review editions")
            for index, selected in enumerate(request["approvalRecords"]):
                record = approval.get("records", selected["recordId"])
                need(record["revision"] == selected["revision"], "Approval export selection differs from actual revision")
                graph = modules["approval_archive"].validate_record(approval, record["id"])
                def inspect_approval(path, expected=copy.deepcopy(record)):
                    _, meta, _ = checked_archive(identity(str(path)), "manifest.json", "catalogue-delivery.approval-export.v1")
                    with zipfile.ZipFile(path) as archive:
                        retained = json.loads(archive.read("approval/records/" + expected["id"] + ".json"))
                    need(retained == expected and meta["record_id"] == expected["id"], "Retained approval export is another revision")
                exported = export_closed(stage / ("approval-" + str(index + 1) + ".zip"),
                    lambda path, record_id=record["id"]: approval.export(record_id, path), inspect_approval)
                exports.append({"archive": exported, "recordId": record["id"], "revision": record["revision"],
                    "jobId": graph["job"]["id"], "sourceId": graph["source"]["id"],
                    "rows": graph["source"]["row_count"], "bytes": graph["source"]["bytes"],
                    "sha256": graph["source"]["sha256"]})
            saved = keep_json(stage / "snapshot.json", observed)
            return finish(stage, request, {"implementationArchive": original, "approvals": exports,
                "implementationId": value["id"], "revision": value["revision"], "snapshot": saved},
                [original, *[x["archive"] for x in exports], saved])
        if action == "replay-receive":
            saved = read_json(descriptor(request["receipt"])["path"])
            need(saved.get("schema") == "stellar-forge.catalogue-delivery-original-result.v1"
                 and saved.get("action") == "receive" and saved["value"]["directory"] == str(root),
                 "Select this receiving operation's original receipt")
            # The application reader is repeatable for the unchanged implementation
            # members. Approval restoration is intentionally a new-directory action;
            # the outer original step receipt is its exact replay boundary.
            chosen, _, _ = checked_implementation(request["implementationArchive"], rows)
            before = observed
            returned = modules["implementation"].receive_package(chosen["path"], str(root / "original-implementation"))
            after = snapshot(store, implementation, modules, stage)
            need(after == before and returned["implementation"]["id"] == saved["value"]["implementationId"],
                 "Original receiving replay changed later retained work")
            copied = copy_exact(Path(request["receipt"]["path"]), stage / "original-receipt.json", request["receipt"])
            current = keep_json(stage / "snapshot.json", after)
            return finish(stage, request, {"receiving": saved, "snapshot": current, "laterChangesPreserved": True},
                          [copied, chosen, current])
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
    need(request.get("action") in ("inspect-original", "receive", "audit", "export", "replay-receive", "compare", "bundle"),
         "Unsupported original helper action")
    with lock(root / "helper.lock"):
        keep_json(root / "source-selection.json", selection)
        _, rows, modules = source_selection(selection)
        stage = directory(str(root / "steps" / request["id"]), create=True)
        keep_json(stage / "request.json", request)
        result = reopen_candidate(stage, request)
        if result is None:
            result = operate(request, stage, rows, modules)
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
