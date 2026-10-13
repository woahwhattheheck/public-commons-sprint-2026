#!/usr/bin/env python3
"""Retain and receive complete original grant, learning and commissioned-study workspaces."""
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

SCHEMA = "stellar-forge.grant-analyst-original-receiving.v1"
SOURCE_SCHEMA = "stellar-forge.grant-analyst-workbench-source.v1"
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
    result = {"schema": "stellar-forge.grant-analyst-original-result.v1",
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
    need(result.get("schema") == "stellar-forge.grant-analyst-original-result.v1"
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
    need(set(mapping) == set(selected_rows) | extras, "Archive contains unselected or omitted members")
    return chosen, manifest, selected_rows


def source_selection(request):
    root = directory(request["applicationDirectory"], private=False)
    manifest_path = regular(request["sourceManifestFile"])
    need(identity(manifest_path)["sha256"] == request["sourceManifestSha256"], "Original source authority changed")
    manifest = read_json(manifest_path)
    need(manifest.get("schema") == SOURCE_SCHEMA and isinstance(manifest.get("files"), list)
         and 0 < len(manifest["files"]) <= 25000, "Invalid source authority")
    rows = {}
    for row in manifest["files"]:
        name = relative(row["path"])
        need(name.casefold() not in {x.casefold() for x in rows}, "Duplicate source member")
        descriptor({"path": str(root / name), "bytes": row["bytes"], "sha256": row["sha256"]})
        rows[name] = row
    need(sum(x["bytes"] for x in rows.values()) <= MAX_JSON, "Source exceeds 32 MiB")
    actual = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            need(not (Path(parent) / name).is_symlink(), "Source directory symlink")
            if name == "__pycache__":
                dirs.remove(name)
        for name in files:
            actual.add(regular(str(Path(parent) / name)).relative_to(root).as_posix())
    need(actual == set(rows), "Full source differs from authority")
    application = root / "application"
    for name in ("analyst", "learning", "study"):
        need(name not in sys.modules, "An unselected original module is already loaded")
    sys.path.insert(0, str(application))
    spec = importlib.util.spec_from_file_location("analyst", application / "analyst.py")
    api = importlib.util.module_from_spec(spec)
    sys.modules["analyst"] = api
    spec.loader.exec_module(api)
    need({"application/" + x for x in api.SOURCE_FILES} ==
         {x for x in rows if x.startswith("application/")}, "Original complete executable source inventory differs")
    for name in ("analyst", "learning", "study"):
        filename = Path(sys.modules[name].__file__).resolve()
        selected = filename.relative_to(root).as_posix()
        need(selected in rows and identity(str(filename))["sha256"] == rows[selected]["sha256"],
             "Executed native module differs from selected source")
    return root, rows, api

def native_archive(selected):
    chosen, manifest, members = checked_archive(selected, "MANIFEST.json", "tjlabs.grant-analyst-handover.v1")
    need(sum(x["bytes"] for x in archive_inventory(chosen["path"])) <= 1024 ** 3, "Original native handover exceeds 1 GiB")
    need("workspace/workspace.json" in members and any(x.startswith("source/") for x in members),
         "The original inner workspace/source handover is required")
    with zipfile.ZipFile(chosen["path"]) as archive:
        state = json.loads(archive.read("workspace/workspace.json"))
    need(state.get("schema") == "tjlabs.grant-analyst-workspace.v1" and state["id"] == manifest["workspace"],
         "Original workspace identity differs")
    return chosen, manifest, members, state

def snapshot(work, api):
    current = api.state(work)
    api.learning.validate(api, current)
    api.study.validate(api, work, current)
    need(type(current.get("requests")) is dict and type(current.get("audit")) is list, "Missing native request history")
    seen = set()
    for row in current["audit"]:
        rid = row["requestId"]
        need(rid not in seen and rid in current["requests"], "Native audit request identity differs")
        seen.add(rid)
        retained = current["requests"][rid]
        need(all(row[key] == retained[key] for key in ("action", "fingerprint", "result")),
             "Native audit and request receipt differ")
    need(seen == set(current["requests"]), "Native request/audit populations differ")
    objects, reports = {}, []
    for entry in current["editions"]:
        package = api.grant_package(work, entry)
        need(len(package["grants"]) == entry["grants"], "Complete grant population differs")
        path = work / "sources" / (entry["sha256"] + ".json")
        observed = identity(str(path))
        need(observed["bytes"] == entry["bytes"] and observed["sha256"] == entry["sha256"], "Original source changed")
        objects[path.relative_to(work).as_posix()] = {key: observed[key] for key in ("bytes", "sha256")}
        if current["selectedCodebook"]:
            report = api.report(work, current, entry["id"])
            report.pop("createdAt", None)
            # Convert only the original API's Decimal output representation.
            reports.append(json.loads(api.public_json(report)))
    for study in current.get("studies", []):
        for row in study["evidence"]:
            if row["document"]:
                doc, raw = api.study.document(api, work, current, study["id"], row["id"], row["number"])
                need(digest_bytes(raw) == {key: doc[key] for key in ("bytes", "sha256")}, "Retained evidence bytes differ")
                objects["evidence/" + doc["sha256"] + ".bin"] = digest_bytes(raw)
    return {"schema": "stellar-forge.grant-analyst-original-snapshot.v1",
            "state": current, "objects": objects, "reports": reports,
            "learning": api.learning.report(current),
            "studies": json.loads(api.public_json(api.study.report(api, current)))}

def compare_prefix(before, after):
    left, right = before["state"], after["state"]
    for key in ("schema", "id", "name", "createdAt"):
        need(left[key] == right[key], "Original workspace identity changed: " + key)
    for key in ("editions", "codebooks", "audit"):
        need(right[key][:len(left[key])] == left[key], "Original complete history changed: " + key)
    for key, value in left["requests"].items():
        need(right["requests"].get(key) == value, "Original saved request changed")
    for key, value in left["reviews"].items():
        need(right["reviews"].get(key, [])[:len(value)] == value, "Original grant decision history changed")
    for key, value in before["objects"].items():
        need(after["objects"].get(key) == value, "Original source or evidence object changed")
    old_cycles = {x["id"]: x for x in left.get("learningCycles", [])}
    new_cycles = {x["id"]: x for x in right.get("learningCycles", [])}
    for identity_, value in old_cycles.items():
        current = new_cycles.get(identity_)
        need(current is not None, "Original learning cycle disappeared")
        for key in set(value) - {"actions", "reviews"}:
            need(current.get(key) == value[key], "Original learning finding or baseline changed")
        need(current["reviews"][:len(value["reviews"])] == value["reviews"], "Original complete cycle review changed")
        actions = {x["id"]: x for x in current["actions"]}
        for old in value["actions"]:
            need(old["id"] in actions and actions[old["id"]]["revisions"][:len(old["revisions"])] == old["revisions"],
                 "Original complete action history changed")
            need(all(actions[old["id"]].get(key) == value for key, value in old.items() if key != "revisions"),
                 "Original learning action identity changed")
    new_studies = {x["id"]: x for x in right.get("studies", [])}
    for value in left.get("studies", []):
        current = new_studies.get(value["id"])
        need(current is not None, "Original study disappeared")
        for key in set(value) - {"revision", "questionEditions", "scopeEditions", "evidence", "answers", "releases", "history"}:
            need(current.get(key) == value[key], "Original study identity changed")
        for key in ("questionEditions", "scopeEditions", "evidence", "answers", "releases", "history"):
            need(current[key][:len(value[key])] == value[key], "Original full study history changed: " + key)
        need(current["revision"] >= value["revision"], "Study revision moved backwards")

def compare_action(before, after, operation, api):
    compare_prefix(before, after)
    need(operation.get("action") == "cycle-action", "This course only changes one explicit technical action note")
    body, rid = operation["body"], operation["requestId"]
    left, right = before["state"], after["state"]
    need(rid not in left["requests"], "Select a new installed-course request against its frozen baseline")
    expected = copy.deepcopy(left)
    cycles = expected.get("learningCycles", [])
    cycle = next((x for x in cycles if x["id"] == body["cycle"]), None)
    need(cycle is not None, "Selected original learning cycle is absent")
    action = next((x for x in cycle["actions"] if x["id"] == body["action"]), None)
    observed_cycle = next(x for x in right["learningCycles"] if x["id"] == body["cycle"])
    observed = next(x for x in observed_cycle["actions"] if x["id"] == body["action"])
    need(action is not None and action["revisions"][-1]["revision"] == body["expectedRevision"], "Action baseline differs")
    need(len(observed["revisions"]) == len(action["revisions"]) + 1, "One exact action revision is required")
    latest, prior = observed["revisions"][-1], action["revisions"][-1]
    for key in ("title", "owner", "dueOn", "successCriteria", "status"):
        need(body[key] == prior[key] and latest[key] == prior[key], "Installed note may not alter an original action judgment")
    for key in ("reviewer", "note", "evidence"):
        need(latest[key] == body[key], "Saved technical action note differs")
    need(latest["revision"] == prior["revision"] + 1, "Action revision differs")
    action["revisions"].append(copy.deepcopy(latest))
    receipt = right["requests"].get(rid)
    need(receipt and receipt["action"] == operation["action"]
         and receipt["fingerprint"] == api.sha(api.public_json({"action": operation["action"], "body": body}).encode()),
         "Original same-request identity differs")
    expected["requests"][rid] = copy.deepcopy(receipt)
    need(len(right["audit"]) == len(left["audit"]) + 1 and right["audit"][-1]["requestId"] == rid,
         "Exactly one installed-course action receipt is required")
    expected["audit"].append(copy.deepcopy(right["audit"][-1]))
    need(expected == right, "Unselected original workspace values changed")

def received(selected, destination, stage, api):
    chosen, manifest, members, original = native_archive(selected)
    destination = Path(destination)
    directory(str(destination.parent), create=True)
    keep_json(stage / "receiving-intent.json", {"archive": chosen, "destination": str(destination)})
    # The source reader publishes one complete directory by rename. Its outer
    # lifetime lock is held on the parent until that directory is available.
    with lock(destination.parent / (".grant-analyst-receive-" + hashlib.sha256(str(destination).encode()).hexdigest() + ".lock")):
        if not destination.exists():
            api.receive_workspace(Path(chosen["path"]), destination)
            fsync_directory(destination.parent)
        root = directory(str(destination))
        receipt = read_json(str(root / "RECEIVING.json"))
        need(receipt.get("archiveSha256") == chosen["sha256"] and receipt.get("bytes") == chosen["bytes"]
             and receipt.get("workspace") == manifest["workspace"], "Existing receiving directory belongs to another input")
        copy_exact(Path(chosen["path"]), root / "original-handover.zip", chosen)
        need(read_json(str(root / "MANIFEST.json")) == manifest, "Original received manifest changed")
        work = root / "workspace"
        with lock(directory(str(work)) / "grant-analyst-operator.lock"):
            with api.locked(work):
                observed = snapshot(work, api)
            # Exact immutable source/report files remain the original donor edition.
            for name, row in members.items():
                if not name.startswith("workspace/"):
                    descriptor({"path": str(root / name), **{k: row[k] for k in ("bytes", "sha256")}})
            baseline = {"state": original,
                "objects": {name[len("workspace/"):]: {k: row[k] for k in ("bytes", "sha256")}
                    for name, row in members.items() if name.startswith(("workspace/sources/", "workspace/evidence/"))}}
            compare_prefix(baseline, observed)
            frozen = stage / "received-snapshot.json"
            if frozen.exists():
                compare_prefix(read_json(str(frozen)), observed)
            else:
                need(observed["state"] == original, "Unreceipted initial receiving contains later changes")
                keep_json(frozen, observed)
    return {"directory": str(destination), "workspace": str(work), "workspaceId": original["id"],
            "archive": chosen, "snapshot": identity(str(frozen)), "includedSource": str(destination / "source")}

def outer_donor(request, stage, api):
    selected = descriptor(request["archive"])
    roster = archive_inventory(selected["path"])
    mapping = {row["path"]: row for row in roster}
    prefix = request.get("operationPrefix", "")
    if prefix:
        prefix = relative(prefix) + "/"
    outcome_member = relative(request["outcomeMember"])
    need(outcome_member in mapping and mapping[outcome_member]["bytes"] <= MAX_JSON, "Select the actual original outcome member")
    need(outcome_member == prefix + "native-outcome.json", "Outcome does not belong to the selected operation directory")
    with zipfile.ZipFile(selected["path"]) as archive:
        outcome = json.loads(archive.read(outcome_member))
        if request["kind"] == "learning":
            need(outcome.get("state") == "COMPLETED" and outcome.get("exitCode") == 0
                 and outcome.get("operationId") == request["operationId"], "Learning native operation is not completed")
            files = outcome["files"]
            need(outcome["fileCount"] == len(files) and outcome["bytes"] == sum(x["bytes"] for x in files),
                 "Original full operated-file totals differ")
        else:
            need(request["kind"] == "study" and outcome.get("schema") == "tjlabs.commissioned-study-native.v1"
                 and outcome.get("outcome") == "COMPLETED" and isinstance(request.get("operationId"), str),
                 "Select the completed original commissioned-study result")
            files_member = relative(request["filesMember"])
            need(files_member == prefix + "FILES.json" and files_member in mapping, "Select the original full native FILES inventory")
            files_record = json.loads(archive.read(files_member))
            need(files_record.get("schema") == "tjlabs.complete-operated-files.v1", "Original study inventory schema differs")
            files = files_record["files"]
    seen = set()
    for row in files:
        name = prefix + relative(row["path"])
        need(name not in seen and name in mapping, "Original operated file is missing or duplicated")
        seen.add(name)
        need(all(row[k] == mapping[name][k] for k in ("bytes", "sha256")), "Original operated file changed: " + name)
    need(files, "Original native operation has no full operated files")
    source_member = relative(request["sourceHandoverMember"])
    successor_member = relative(request["successorMember"])
    need(source_member in seen and successor_member in seen, "Both native original and successor handovers must be operated files")
    expected = (outcome["sourceHandover"], outcome["receivingSuccessor"]) if request["kind"] == "learning" else (outcome["completeHandover"], outcome["receiverHandover"])
    archives = []
    for index, (name, selected_inner) in enumerate(zip((source_member, successor_member), expected)):
        need(all(mapping[name][k] == selected_inner[k] for k in ("bytes", "sha256")), "Original handover result binding differs")
        path = stage / ("source-handover.zip" if index == 0 else "successor-handover.zip")
        extracted = extract_member(selected["path"], name, path, selected_inner)
        archives.append(native_archive(extracted))
    original, successor = archives
    need(original[1]["workspace"] == successor[1]["workspace"], "Native successor changed original workspace identity")
    if request["kind"] == "learning":
        need(successor[1]["workspace"] == outcome["workspaceId"], "Learning result workspace differs")
        original_sources = {row["path"]: {k: row[k] for k in ("bytes", "sha256")} for row in outcome["source"]}
        for item in archives:
            inner_sources = {name[7:]: {k: row[k] for k in ("bytes", "sha256")}
                             for name, row in item[2].items() if name.startswith("source/")}
            need(inner_sources == original_sources, "Learning handover did not retain its exact original executable source")
    else:
        need(successor[1]["workspace"] == outcome["workspace"], "Study result workspace differs")
        need(original[3]["studies"][0]["revision"] == outcome["sourceRevision"]
             and successor[3]["studies"][0]["revision"] == outcome["receiverRevision"], "Native study revision differs")
        for row in outcome["steps"]:
            rid = row["requestId"]
            value = successor[3]["requests"].get(rid)
            need(value and value["action"] == row["action"] and row.get("replayed") is True
                 and value["result"] == {k: v for k, v in row["result"].items() if k != "reused"},
                 "Original native mutation/replay receipt differs")
    original_received = received(original[0], stage / "original-source-station", stage / "source-receive", api)
    successor_received = received(successor[0], stage / "original-successor-station", stage / "successor-receive", api)
    a = read_json(original_received["snapshot"]["path"])
    b = read_json(successor_received["snapshot"]["path"])
    compare_prefix(a, b)
    if request["kind"] == "learning":
        cycles = b["learning"]["cycles"]
        need(len(cycles) == outcome["cycles"] and sum(len(x["actions"]) for x in cycles) == outcome["actions"]
             and sum(len(x["reviews"]) for x in cycles) == outcome["reviews"], "Complete learning population differs")
    outer_copy = copy_exact(Path(selected["path"]), stage / "original-complete-delivery.zip", selected)
    manifest = keep_json(stage / "original-complete-delivery-members.json", {"archive": outer_copy, "files": roster})
    outcome_copy = extract_member(selected["path"], outcome_member, stage / "native-outcome.json", mapping[outcome_member])
    return finish(stage, request, {"kind": request["kind"], "operationId": request["operationId"],
                  "outer": outer_copy, "inventory": manifest, "outcome": outcome_copy,
                  "sourceHandover": original[0], "successorHandover": successor[0],
                  "sourceStation": original_received, "successorStation": successor_received,
                  "snapshot": successor_received["snapshot"]},
                  [outer_copy, manifest, outcome_copy, original[0], successor[0],
                   original_received["snapshot"], successor_received["snapshot"]])

def export_closed(path, invoke, inspect):
    if path.exists():
        try:
            inspect(path)
        except (zipfile.BadZipFile, EOFError):
            os.rename(path, path.with_name(path.name + "." + secrets.token_hex(8) + ".interrupted"))
            fsync_directory(path.parent)
    if not path.exists():
        invoke(path)
        with path.open("rb") as stream:
            os.fsync(stream.fileno())
        fsync_directory(path.parent)
    inspect(path)
    return identity(str(path))
def operate(request, stage, rows, api):
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
        manifest = {"schema": "stellar-forge.grant-analyst-installed-handover.v1",
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
    if action == "inspect-original":
        return outer_donor(request, stage, api)
    if action in ("receive", "inspect-archive"):
        target = request["directory"] if action == "receive" else str(stage / "independent-inspection")
        value = received(request["archive"], target, stage, api)
        if request.get("expectedSnapshot"):
            expected = read_json(descriptor(request["expectedSnapshot"])["path"])
            actual = read_json(value["snapshot"]["path"])
            need(actual == expected, "Complete received state, reports, source or history differ")
        if request.get("currentSource"):
            _, _, members, _ = native_archive(request["archive"])
            actual = {name[7:]: {k: row[k] for k in ("bytes", "sha256")} for name, row in members.items() if name.startswith("source/")}
            selected = {name[len("application/"):]: {k: row[k] for k in ("bytes", "sha256")} for name, row in rows.items() if name.startswith("application/")}
            need(actual == selected, "Current handover must include every selected original executable member")
        return finish(stage, request, value, [descriptor(request["archive"]), value["snapshot"]])
    if action == "compare":
        before = read_json(descriptor(request["before"])["path"])
        after = read_json(descriptor(request["after"])["path"])
        if request.get("operation"):
            compare_action(before, after, request["operation"], api)
        elif request.get("exact", True):
            need(before == after, "Complete original snapshots differ")
        else:
            compare_prefix(before, after)
        return finish(stage, request, {"unchangedOriginalHistory": True,
            "operation": request.get("operation"), "workspaceId": after["state"]["id"],
            "sources": len(after["state"]["editions"]), "grants": sum(x["grants"] for x in after["state"]["editions"])},
            [descriptor(request["before"]), descriptor(request["after"])])
    work = directory(request["workspace"])
    with lock(work / "grant-analyst-operator.lock"):
        with api.locked(work):
            observed = snapshot(work, api)
        if request.get("expectedSnapshot"):
            expected = read_json(descriptor(request["expectedSnapshot"])["path"])
            if request.get("operation"):
                compare_action(expected, observed, request["operation"], api)
            elif request.get("exact", True):
                need(expected == observed, "Original workspace changed")
            else:
                compare_prefix(expected, observed)
        if action == "audit":
            saved = keep_json(stage / "snapshot.json", observed)
            return finish(stage, request, {"snapshot": saved, "workspace": str(work),
                "workspaceId": observed["state"]["id"], "editions": observed["state"]["editions"],
                "cycles": len(observed["learning"]["cycles"]), "studies": len(observed["studies"]["studies"])}, [saved])
        if action == "export":
            chosen_state = copy.deepcopy(observed)
            def inspect(path):
                _, _, members, state = native_archive(identity(str(path)))
                need(state == chosen_state["state"], "Closed export is not the selected complete original state")
                source = {name[7:]: {k: row[k] for k in ("bytes", "sha256")} for name, row in members.items() if name.startswith("source/")}
                expected = {name[len("application/"):]: {k: row[k] for k in ("bytes", "sha256")} for name, row in rows.items() if name.startswith("application/")}
                need(source == expected, "Closed export omitted or changed selected source")
            exported = export_closed(stage / "complete-handover.zip",
                lambda path: api.export_workspace(work, path), inspect)
            with api.locked(work):
                need(snapshot(work, api) == chosen_state, "Original workspace changed while exporting")
            saved = keep_json(stage / "snapshot.json", chosen_state)
            return finish(stage, request, {"archive": exported, "snapshot": saved,
                "workspaceId": observed["state"]["id"], "workspace": str(work)}, [exported, saved])
        if action == "replay-action":
            operation = request["operation"]
            rid, body, method = operation["requestId"], operation["body"], operation["action"]
            need(rid in observed["state"]["requests"], "Reopen an already saved original request")
            returned = api.mutation(work, rid, method, body)
            need(returned.get("reused") is True, "Original request did not replay")
            with api.locked(work):
                need(snapshot(work, api) == observed, "Same-request replay changed original workspace")
            saved = keep_json(stage / "snapshot.json", observed)
            response = keep_json(stage / "native-replay.json", returned)
            return finish(stage, request, {"snapshot": saved, "response": response,
                "workspaceId": observed["state"]["id"], "requestId": rid}, [saved, response])
        if action == "replay-receive":
            receipt = read_json(descriptor(request["receipt"])["path"])
            need(receipt.get("schema") == "stellar-forge.grant-analyst-original-result.v1"
                 and receipt.get("action") == "receive"
                 and receipt["value"]["workspace"] == str(work), "Select the original receive receipt for this workspace")
            chosen = descriptor(receipt["value"]["archive"])
            original_receipt = read_json(str(work.parent / "RECEIVING.json"))
            need(original_receipt["archiveSha256"] == chosen["sha256"]
                 and original_receipt["workspace"] == observed["state"]["id"], "Received input identity changed")
            baseline = read_json(descriptor(receipt["value"]["snapshot"])["path"])
            compare_prefix(baseline, observed)
            saved = keep_json(stage / "current-snapshot.json", observed)
            copied = copy_exact(Path(request["receipt"]["path"]), stage / "original-receive-result.json", request["receipt"])
            return finish(stage, request, {"receiving": receipt, "snapshot": saved,
                "laterChangesPreserved": True, "nativeReaderReexecuted": False},
                [saved, copied, chosen])
    raise ValueError("Unknown original helper action")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args(argv)
    selection = read_json(args.selection)
    need(selection.get("schema") == SCHEMA, "Select the original source contract")
    root = directory(args.directory, create=True)
    request = read_json(args.request)
    need(isinstance(request.get("id"), str) and IDENTIFIER.fullmatch(request["id"]), "Invalid retained step identity")
    need(request.get("action") in ("inspect-original", "receive", "inspect-archive", "audit",
        "export", "replay-action", "replay-receive", "compare", "bundle"), "Unsupported helper action")
    with lock(root / "helper.lock"):
        keep_json(root / "source-selection.json", selection)
        _, rows, api = source_selection(selection)
        stage = directory(str(root / "steps" / request["id"]), create=True)
        keep_json(stage / "request.json", request)
        result = reopen_candidate(stage, request)
        if result is None:
            result = operate(request, stage, rows, api)
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
