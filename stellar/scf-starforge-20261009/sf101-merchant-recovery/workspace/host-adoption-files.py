#!/usr/bin/env python3
# MIT. Original SF101 host adoption: descriptor copies under the inherited SF98 lease.
# No network, subprocess, native recovery engine, deletion, or destination replacement.
import ctypes
import errno
import hashlib
import json
import os
import re
import signal
import stat
import sys
import time
import uuid

MAX_JSON = 32 * 1024 * 1024
MAX_FILE = 2 * 1024 ** 3
MAX_ENTRIES = 10000
SCHEMA = "stellar-forge.host-adoption-operation.v1"
HASH = re.compile(r"^[0-9a-f]{64}$")
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
RD = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
RF = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
WF = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = libc.renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int

def fail(code):
    raise RuntimeError(code)

def need(ok, code):
    if not ok:
        fail(code)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def raw_json(value):
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def identity(info):
    return {"dev": str(info.st_dev), "ino": str(info.st_ino)}

def same_node(a, b):
    return a.st_dev == b.st_dev and a.st_ino == b.st_ino

def file_unchanged(a, b):
    return same_node(a, b) and a.st_size == b.st_size and a.st_mtime_ns == b.st_mtime_ns and a.st_ctime_ns == b.st_ctime_ns

def absolute(path):
    need(isinstance(path, str) and 0 < len(path) <= 4096 and path.startswith("/") and path != "/" and
         "\0" not in path and os.path.normpath(path) == path and not path.startswith("//"),
         "HOST_ADOPTION_ABSOLUTE_PATH_REQUIRED")
    return path

def overlaps(a, b):
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")

def open_directory(path, private=False):
    absolute(path)
    current = os.open("/", RD)
    try:
        for part in path[1:].split("/"):
            child = os.open(part, RD, dir_fd=current)
            os.close(current)
            current = child
        info = os.fstat(current)
        need(stat.S_ISDIR(info.st_mode), "HOST_ADOPTION_DIRECTORY_REQUIRED")
        if private:
            need(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                 "HOST_ADOPTION_PRIVATE_DIRECTORY_REQUIRED")
        return current
    except BaseException:
        os.close(current)
        raise

def named_directory(path, descriptor):
    current = open_directory(path)
    try:
        need(same_node(os.fstat(current), os.fstat(descriptor)), "HOST_ADOPTION_DIRECTORY_REPLACED")
    finally:
        os.close(current)

def named(fd, name):
    try:
        return os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None

def checked_file(fd, private=True, maximum=MAX_FILE):
    info = os.fstat(fd)
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum,
         "HOST_ADOPTION_REGULAR_FILE_REQUIRED")
    if private:
        need(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600,
             "HOST_ADOPTION_PRIVATE_FILE_REQUIRED")
    return info

def read_at(parent, name, maximum=MAX_JSON):
    fd = os.open(name, RF, dir_fd=parent)
    try:
        before = checked_file(fd, True, maximum)
        pieces, length = [], 0
        while True:
            chunk = os.read(fd, min(65536, maximum + 1 - length))
            if not chunk:
                break
            pieces.append(chunk)
            length += len(chunk)
            need(length <= maximum, "HOST_ADOPTION_JSON_LIMIT")
        after, current = os.fstat(fd), named(parent, name)
        need(file_unchanged(before, after) and current is not None and same_node(before, current) and
             length == before.st_size, "HOST_ADOPTION_FILE_CHANGED")
        return b"".join(pieces)
    finally:
        os.close(fd)

def json_at(parent, name, optional=False):
    try:
        return json.loads(read_at(parent, name).decode("utf-8"))
    except FileNotFoundError:
        if optional:
            return None
        raise

def rename_new(source_fd, source_name, target_fd, target_name):
    result = renameat2(source_fd, os.fsencode(source_name), target_fd, os.fsencode(target_name), 1)
    if result:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))

def write_all(fd, value):
    view = memoryview(value)
    while view:
        count = os.write(fd, view)
        need(count > 0, "HOST_ADOPTION_WRITE_INCOMPLETE")
        view = view[count:]

def retain(parent, name, value):
    expected = raw_json(value)
    need(len(expected) <= MAX_JSON, "HOST_ADOPTION_JSON_LIMIT")
    existing = named(parent, name)
    if existing is not None:
        need(read_at(parent, name) == expected, "HOST_ADOPTION_RETAINED_RECORD_CHANGED")
        fd = os.open(name, RF, dir_fd=parent)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(parent)
        return value
    # One original deterministic partial publication, never a partial final.
    temporary = ".adoption-" + name + ".partial"
    try:
        fd = os.open(temporary, WF | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=parent)
    except FileExistsError:
        fd = os.open(temporary, WF, dir_fd=parent)
    try:
        before = checked_file(fd, True, MAX_JSON)
        need(before.st_size <= len(expected), "HOST_ADOPTION_RECORD_PREFIX_CHANGED")
        offset = 0
        while offset < before.st_size:
            piece = os.read(fd, min(65536, before.st_size - offset))
            need(piece and piece == expected[offset:offset + len(piece)], "HOST_ADOPTION_RECORD_PREFIX_CHANGED")
            offset += len(piece)
        write_all(fd, expected[offset:])
        os.fsync(fd)
        current = named(parent, temporary)
        need(current is not None and same_node(before, current), "HOST_ADOPTION_RECORD_REPLACED")
    finally:
        os.close(fd)
    rename_new(parent, temporary, parent, name)
    os.fsync(parent)
    return value

def operation_token(operation):
    final, partial = "operation-token", ".operation-token.partial"
    if named(operation, final) is not None:
        token = read_at(operation, final, 32)
        need(len(token) == 32 and re.fullmatch(b"[0-9a-f]{32}", token), "HOST_ADOPTION_TOKEN_CHANGED")
        fd = os.open(final, RF, dir_fd=operation)
        try:
            os.fsync(fd)
            when = os.fstat(fd).st_mtime
        finally:
            os.close(fd)
        os.fsync(operation)
        return token.decode("ascii"), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(when))
    try:
        fd = os.open(partial, WF | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=operation)
    except FileExistsError:
        fd = os.open(partial, WF, dir_fd=operation)
    try:
        info = checked_file(fd, True, 32)
        prefix = os.read(fd, 33)
        need(len(prefix) == info.st_size and re.fullmatch(b"[0-9a-f]{0,32}", prefix),
             "HOST_ADOPTION_TOKEN_CHANGED")
        token = prefix + uuid.uuid4().hex.encode("ascii")[:32-len(prefix)]
        write_all(fd, token[len(prefix):])
        os.fsync(fd)
        current = named(operation, partial)
        need(current is not None and same_node(info, current), "HOST_ADOPTION_TOKEN_REPLACED")
    finally:
        os.close(fd)
    rename_new(operation, partial, operation, final)
    os.fsync(operation)
    return operation_token(operation)

def retain_completion(operation, expected, result):
    final, partial = "result.json", ".adoption-result.json.partial"
    existing = json_at(operation, final, optional=True)
    if existing is not None:
        need(existing.get("schema") == SCHEMA and existing.get("reviewSha256") == expected and
             isinstance(existing.get("result"), dict) and existing["result"].get("reviewSha256") == expected and
             existing["result"].get("status") == "HOST_HANDOFF_ADOPTED", "HOST_ADOPTION_RESULT_CHANGED")
        retain(operation, final, existing)
        return existing["result"]
    envelope = {"schema": SCHEMA, "reviewSha256": expected, "result": result}
    if named(operation, partial) is not None:
        raw = read_at(operation, partial)
        recovered, parsed = None, False
        try:
            recovered = json.loads(raw.decode("utf-8"))
            parsed = True
        except (UnicodeError, json.JSONDecodeError):
            # This is one unpublished metadata stage inside the bound private
            # operation, not a canonical root or a committed request/result.
            pass
        if parsed:
            need(isinstance(recovered, dict) and recovered.get("schema") == SCHEMA and
                 recovered.get("reviewSha256") == expected and isinstance(recovered.get("result"), dict) and
                 recovered["result"].get("status") == "HOST_HANDOFF_ADOPTED" and
                 recovered["result"].get("reviewSha256") == expected, "HOST_ADOPTION_RESULT_CHANGED")
            envelope = recovered
        else:
            fd = os.open(partial, WF, dir_fd=operation)
            try:
                before = checked_file(fd, True, MAX_JSON)
                current = named(operation, partial)
                need(current is not None and same_node(before, current), "HOST_ADOPTION_RECORD_REPLACED")
                os.ftruncate(fd, 0)
                os.fsync(fd)
            finally:
                os.close(fd)
    retain(operation, final, envelope)
    return envelope["result"]

def check_root(root):
    need(isinstance(root, dict) and NAME.fullmatch(root.get("name", "")) and root.get("kind") in ("file", "directory"),
         "HOST_ADOPTION_ROOT_INVALID")
    absolute(root.get("destination"))
    absolute(root.get("restored"))
    return root

def check_entries(entries, kind):
    need(isinstance(entries, list) and 0 < len(entries) <= MAX_ENTRIES, "HOST_ADOPTION_ENTRIES_LIMIT")
    by_path = {}
    for row in entries:
        need(isinstance(row, dict) and row.get("kind") in ("file", "directory"), "HOST_ADOPTION_ENTRY_INVALID")
        rel = row.get("relative")
        need(isinstance(rel, str) and len(rel) <= 2048 and "\\" not in rel and "\0" not in rel and
             (rel == "" or all(p and p not in (".", "..") for p in rel.split("/"))),
             "HOST_ADOPTION_RELATIVE_PATH_INVALID")
        need(rel not in by_path, "HOST_ADOPTION_DUPLICATE_ENTRY")
        if row["kind"] == "file":
            need(set(row) == {"relative", "kind", "bytes", "sha256"} and type(row["bytes"]) is int and
                 0 <= row["bytes"] <= MAX_FILE and HASH.fullmatch(row["sha256"] or ""),
                 "HOST_ADOPTION_FILE_IDENTITY_INVALID")
        else:
            need(set(row) == {"relative", "kind"}, "HOST_ADOPTION_ENTRY_INVALID")
        by_path[rel] = row
    need("" in by_path and by_path[""]["kind"] == kind and (kind != "file" or len(entries) == 1),
         "HOST_ADOPTION_ROOT_INVENTORY_INVALID")
    for rel in by_path:
        if rel:
            parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
            need(parent in by_path and by_path[parent]["kind"] == "directory",
                 "HOST_ADOPTION_PARENT_INVENTORY_MISSING")
    return by_path

def walk(parent, name, prefix="", private=True):
    info = named(parent, name)
    need(info is not None and not stat.S_ISLNK(info.st_mode), "HOST_ADOPTION_TREE_CHANGED")
    if stat.S_ISREG(info.st_mode):
        need(info.st_nlink == 1 and (not private or info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600),
             "HOST_ADOPTION_TREE_MODE_CHANGED")
        return {prefix: "file"}
    need(stat.S_ISDIR(info.st_mode), "HOST_ADOPTION_TREE_KIND_INVALID")
    fd = os.open(name, RD, dir_fd=parent)
    try:
        need(same_node(info, os.fstat(fd)), "HOST_ADOPTION_TREE_CHANGED")
        if private:
            need(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                 "HOST_ADOPTION_TREE_MODE_CHANGED")
        result = {prefix: "directory"}
        for child in sorted(os.listdir(fd)):
            child_prefix = prefix + "/" + child if prefix else child
            result.update(walk(fd, child, child_prefix, private))
            need(len(result) <= MAX_ENTRIES, "HOST_ADOPTION_ENTRIES_LIMIT")
        current = named(parent, name)
        need(current is not None and same_node(current, info), "HOST_ADOPTION_TREE_CHANGED")
        return result
    finally:
        os.close(fd)

def relative_parent(root_fd, rel):
    parts = rel.split("/")
    current = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            child = os.open(part, RD, dir_fd=current)
            os.close(current)
            current = child
        return current, parts[-1]
    except BaseException:
        os.close(current)
        raise

def file_digest(parent, name, row, private=True):
    fd = os.open(name, RF, dir_fd=parent)
    try:
        before = checked_file(fd, private)
        need(before.st_size == row["bytes"], "HOST_ADOPTION_FILE_LENGTH_CHANGED")
        sha, count = hashlib.sha256(), 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            count += len(chunk)
            need(count <= row["bytes"], "HOST_ADOPTION_FILE_LENGTH_CHANGED")
            sha.update(chunk)
        current = named(parent, name)
        need(file_unchanged(before, os.fstat(fd)) and current is not None and same_node(before, current) and
             count == row["bytes"] and sha.hexdigest() == row["sha256"], "HOST_ADOPTION_FILE_BYTES_CHANGED")
        return before
    finally:
        os.close(fd)

def verify_tree(parent, name, entries, private=True):
    actual = walk(parent, name, private=private)
    need(actual == {row["relative"]: row["kind"] for row in entries}, "HOST_ADOPTION_COMPLETE_TREE_CHANGED")
    root_info = named(parent, name)
    if root_info is None:
        fail("HOST_ADOPTION_TREE_CHANGED")
    if stat.S_ISREG(root_info.st_mode):
        file_digest(parent, name, entries[0], private)
    else:
        root = os.open(name, RD, dir_fd=parent)
        try:
            for row in entries:
                if row["kind"] == "file":
                    fd, leaf = relative_parent(root, row["relative"])
                    try:
                        file_digest(fd, leaf, row, private)
                    finally:
                        os.close(fd)
        finally:
            os.close(root)
    current = named(parent, name)
    need(current is not None and same_node(root_info, current), "HOST_ADOPTION_TREE_CHANGED")
    return root_info

def copy_file(source_parent, source_name, target_parent, target_name, row):
    source = os.open(source_name, RF, dir_fd=source_parent)
    target = None
    try:
        before = checked_file(source, True)
        need(before.st_size == row["bytes"], "HOST_ADOPTION_SOURCE_LENGTH_CHANGED")
        try:
            target = os.open(target_name, WF | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=target_parent)
        except FileExistsError:
            target = os.open(target_name, WF, dir_fd=target_parent)
        start = checked_file(target, True)
        need(start.st_size <= row["bytes"], "HOST_ADOPTION_PARTIAL_LENGTH_CHANGED")
        # Compare the entire retained prefix before extending the same file.
        remaining, sha = start.st_size, hashlib.sha256()
        while remaining:
            count = min(65536, remaining)
            a, b = os.read(source, count), os.read(target, count)
            need(len(a) == count and a == b, "HOST_ADOPTION_PARTIAL_BYTES_CHANGED")
            sha.update(a)
            remaining -= count
        while True:
            chunk = os.read(source, 65536)
            if not chunk:
                break
            need(os.lseek(target, 0, os.SEEK_CUR) + len(chunk) <= row["bytes"], "HOST_ADOPTION_SOURCE_LENGTH_CHANGED")
            sha.update(chunk)
            write_all(target, chunk)
        need(file_unchanged(before, os.fstat(source)) and sha.hexdigest() == row["sha256"] and
             os.fstat(target).st_size == row["bytes"], "HOST_ADOPTION_SOURCE_BYTES_CHANGED")
        source_named, target_named = named(source_parent, source_name), named(target_parent, target_name)
        need(source_named is not None and same_node(before, source_named) and target_named is not None and
             same_node(start, target_named), "HOST_ADOPTION_FILE_REPLACED")
        os.fsync(target)
        os.fsync(target_parent)
    finally:
        if target is not None:
            os.close(target)
        os.close(source)

def check_lease(operation):
    inherited = os.fstat(3)
    current = named(operation, ".sf98-delivery.lock")
    need(current is not None and stat.S_ISREG(inherited.st_mode) and inherited.st_nlink == 1 and
         same_node(inherited, current) and not stat.S_IMODE(inherited.st_mode) & 0o077,
         "SF98_ACTIVE_DELIVERY_LEASE_REQUIRED")

def load_operation(operation, directory, expected=None, absent=False):
    value = json_at(operation, "adoption.json", optional=absent)
    if value is None:
        return None
    need(value.get("schema") == SCHEMA and value.get("directory") == directory and
         value.get("directoryIdentity") == identity(os.fstat(operation)), "HOST_ADOPTION_OPERATION_CHANGED")
    need(isinstance(value.get("bindingJSON"), str) and digest(value["bindingJSON"].encode("utf-8")) == value.get("reviewSha256") and
         json.loads(value["bindingJSON"]) == value.get("binding"), "HOST_ADOPTION_BINDING_CHANGED")
    need(value.get("roots") == value["binding"].get("roots") and
         value["binding"].get("adoption", {}).get("directory") == directory and
         re.fullmatch(r"[0-9a-f]{32}", value.get("token", "")) and isinstance(value.get("reservedPaths"), list),
         "HOST_ADOPTION_BINDING_CHANGED")
    if expected is not None:
        need(value["reviewSha256"] == expected, "HOST_ADOPTION_REVIEW_CHANGED")
    return value

def operation_summary(operation, value):
    if value is None:
        return {"schema": SCHEMA, "status": "ABSENT", "result": None,
                "validation": "RECORDED_ONLY_NOT_FRESH_ROOT_VALIDATION"}
    publications = []
    for root in value["roots"]:
        record = json_at(operation, "published-" + root["name"] + ".json", optional=True)
        if record is not None:
            need(record.get("reviewSha256") == value["reviewSha256"] and record.get("name") == root["name"] and
                 record.get("destination") == root["destination"], "HOST_ADOPTION_PUBLICATION_CHANGED")
            publications.append(record)
    result_record = json_at(operation, "result.json", optional=True)
    if result_record is not None:
        need(result_record.get("reviewSha256") == value["reviewSha256"] and isinstance(result_record.get("result"), dict),
             "HOST_ADOPTION_RESULT_CHANGED")
    return {"schema": SCHEMA, "status": "RECORDED_COMPLETE" if result_record else "PREPARED",
            "reviewSha256": value["reviewSha256"], "binding": value["binding"], "roots": value["roots"],
            "publications": publications, "result": result_record["result"] if result_record else None,
            "validation": "RECORDED_ONLY_NOT_FRESH_ROOT_VALIDATION"}

def status_root(operation, value, root):
    intent = json_at(operation, "root-" + root["name"] + ".json", optional=True)
    if intent is not None:
        expected_stage = os.path.join(os.path.dirname(root["destination"]), ".sf101-adoption-" + value["token"] + "-" + root["name"])
        need(intent.get("reviewSha256") == value["reviewSha256"] and intent.get("root") == root and
             intent.get("stage") == expected_stage, "HOST_ADOPTION_STAGE_OWNER_CHANGED")
    stage = None if intent is None else intent["stage"]
    def present(path):
        try:
            parent = open_directory(os.path.dirname(path))
        except FileNotFoundError:
            return False
        try:
            return named(parent, os.path.basename(path)) is not None
        finally:
            os.close(parent)
    return {"name": root["name"], "destination": root["destination"], "stage": stage,
            "destinationPresent": present(root["destination"]), "stagePresent": present(stage) if stage else False,
            "validation": "PRESENCE_ONLY_NOT_NATIVE_VERIFICATION"}

def publish(operation, directory, value, root, entries_json, entries_sha):
    check_root(root)
    need(root in value["roots"], "HOST_ADOPTION_ROOT_CHANGED")
    need(digest(entries_json.encode("utf-8")) == entries_sha, "HOST_ADOPTION_ENTRIES_CHANGED")
    entries = json.loads(entries_json)
    by_path = check_entries(entries, root["kind"])
    parent_path, leaf = os.path.dirname(root["destination"]), os.path.basename(root["destination"])
    parent = open_directory(parent_path)
    stage_fd = None
    try:
        parent_identity = identity(os.fstat(parent))
        stage = os.path.join(parent_path, ".sf101-adoption-" + value["token"] + "-" + root["name"])
        need(not any(overlaps(stage, path) for path in value["reservedPaths"] + [directory]), "HOST_ADOPTION_STAGE_OVERLAP")
        intent = {"schema": "stellar-forge.host-adoption-root.v1", "reviewSha256": value["reviewSha256"],
                  "root": root, "stage": stage, "parentIdentity": parent_identity,
                  "entriesJSON": entries_json, "entriesSha256": entries_sha}
        retain(operation, "root-" + root["name"] + ".json", intent)
        named_directory(directory, operation)
        stage_name = os.path.basename(stage)
        owner = {"schema": "stellar-forge.host-adoption-stage.v1", "reviewSha256": value["reviewSha256"],
                 "root": root, "entriesSha256": entries_sha, "token": value["token"],
                 "parentIdentity": parent_identity}
        if named(parent, stage_name) is None:
            need(named(parent, leaf) is None, "HOST_ADOPTION_DESTINATION_EXISTS")
            # Publish a complete provenance-bearing empty container first. A crash
            # before this rename leaves only an unselected private .creating dir;
            # it never makes a canonical destination or a selected stage partial.
            temporary = stage_name + ".creating-" + uuid.uuid4().hex
            os.mkdir(temporary, 0o700, dir_fd=parent)
            temp = os.open(temporary, RD, dir_fd=parent)
            try:
                stage_owner = dict(owner, directoryIdentity=identity(os.fstat(temp)))
                retain(temp, "owner.json", stage_owner)
                os.fsync(temp)
                named_directory(parent_path, parent)
                rename_new(parent, temporary, parent, stage_name)
                os.fsync(parent)
            finally:
                os.close(temp)
        stage_fd = os.open(stage_name, RD, dir_fd=parent)
        stage_info = os.fstat(stage_fd)
        need(stat.S_IMODE(stage_info.st_mode) == 0o700 and stage_info.st_uid == os.geteuid(),
             "HOST_ADOPTION_STAGE_MODE_CHANGED")
        expected_owner = dict(owner, directoryIdentity=identity(stage_info))
        need(json_at(stage_fd, "owner.json") == expected_owner, "HOST_ADOPTION_STAGE_OWNER_CHANGED")
        need(set(os.listdir(stage_fd)) <= {"owner.json", "tree", "publication.json", ".adoption-publication.json.partial"}, "HOST_ADOPTION_STAGE_INVENTORY_CHANGED")
        publication = json_at(stage_fd, "publication.json", optional=True)
        if named(parent, leaf) is not None:
            need(publication is not None and named(stage_fd, "tree") is None and
                 identity(named(parent, leaf)) == publication.get("treeIdentity"),
                 "HOST_ADOPTION_DESTINATION_EXISTS")
            verify_tree(parent, leaf, entries)
        else:
            if named(stage_fd, "tree") is None:
                need(publication is None, "HOST_ADOPTION_PUBLISHED_ROOT_MISSING")
                if root["kind"] == "directory":
                    os.mkdir("tree", 0o700, dir_fd=stage_fd)
                    os.fsync(stage_fd)
            if root["kind"] == "directory":
                actual = walk(stage_fd, "tree")
                need(all(path in by_path and by_path[path]["kind"] == kind for path, kind in actual.items()),
                     "HOST_ADOPTION_PARTIAL_INVENTORY_CHANGED")
                source = open_directory(root["restored"], True)
                target = os.open("tree", RD, dir_fd=stage_fd)
                try:
                    for row in sorted(entries, key=lambda r: (r["relative"].count("/"), r["relative"])):
                        rel = row["relative"]
                        if not rel:
                            continue
                        dest_parent, dest_name = relative_parent(target, rel)
                        try:
                            if row["kind"] == "directory":
                                if named(dest_parent, dest_name) is None:
                                    os.mkdir(dest_name, 0o700, dir_fd=dest_parent)
                                info = named(dest_parent, dest_name)
                                need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and
                                     stat.S_IMODE(info.st_mode) == 0o700, "HOST_ADOPTION_PARTIAL_DIRECTORY_CHANGED")
                                os.fsync(dest_parent)
                            else:
                                src_parent, src_name = relative_parent(source, rel)
                                try:
                                    copy_file(src_parent, src_name, dest_parent, dest_name, row)
                                finally:
                                    os.close(src_parent)
                        finally:
                            os.close(dest_parent)
                        named_directory(directory, operation)
                        named_directory(parent_path, parent)
                        need(same_node(stage_info, named(parent, stage_name)), "HOST_ADOPTION_STAGE_REPLACED")
                        named_directory(root["restored"], source)
                    for row in sorted((r for r in entries if r["kind"] == "directory"),
                                      key=lambda r: r["relative"].count("/"), reverse=True):
                        if row["relative"]:
                            fd, name = relative_parent(target, row["relative"])
                            child = os.open(name, RD, dir_fd=fd)
                            try:
                                os.fsync(child)
                            finally:
                                os.close(child)
                                os.close(fd)
                    os.fsync(target)
                finally:
                    os.close(source)
                    os.close(target)
            else:
                source_parent = open_directory(os.path.dirname(root["restored"]))
                try:
                    copy_file(source_parent, os.path.basename(root["restored"]), stage_fd, "tree", by_path[""])
                    named_directory(os.path.dirname(root["restored"]), source_parent)
                finally:
                    os.close(source_parent)
            tree_info = verify_tree(stage_fd, "tree", entries)
            publication = {"schema": "stellar-forge.host-adoption-publication.v1",
                           "reviewSha256": value["reviewSha256"], "entriesSha256": entries_sha,
                           "destination": root["destination"], "treeIdentity": identity(tree_info)}
            retain(stage_fd, "publication.json", publication)
            named_directory(directory, operation)
            named_directory(parent_path, parent)
            need(same_node(stage_info, named(parent, stage_name)) and
                 same_node(tree_info, named(stage_fd, "tree")), "HOST_ADOPTION_STAGE_REPLACED")
            check_lease(operation)
            rename_new(stage_fd, "tree", parent, leaf)
            os.fsync(stage_fd)
            os.fsync(parent)
            need(identity(named(parent, leaf)) == publication["treeIdentity"], "HOST_ADOPTION_DESTINATION_REPLACED")
        named_directory(parent_path, parent)
        named_directory(directory, operation)
        os.fsync(parent)
        receipt = {"name": root["name"], "status": "PUBLISHED", "destination": root["destination"],
                   "entriesSha256": entries_sha, "reviewSha256": value["reviewSha256"],
                   "treeIdentity": publication["treeIdentity"]}
        retain(operation, "published-" + root["name"] + ".json", receipt)
        return receipt
    finally:
        if stage_fd is not None:
            os.close(stage_fd)
        os.close(parent)

def main(request):
    action = request.get("action")
    need(action in ("prepare", "read", "inspect", "inspectRoot", "publish", "complete"), "HOST_ADOPTION_ACTION_INVALID")
    directory = absolute(request.get("directory"))
    expected = request.get("reviewSha256")
    need(HASH.fullmatch(expected or ""), "HOST_ADOPTION_REVIEW_REQUIRED")
    try:
        operation = open_directory(directory, True)
    except FileNotFoundError:
        need(action in ("read", "inspect"), "HOST_ADOPTION_OPERATION_MISSING")
        return dict(operation_summary(None, None), reviewSha256=expected, roots=[])
    try:
        if request.get("directoryIdentity") is not None:
            need(identity(os.fstat(operation)) == request["directoryIdentity"], "HOST_ADOPTION_DIRECTORY_REPLACED")
        if action in ("prepare", "publish", "complete"):
            check_lease(operation)
        value = load_operation(operation, directory, expected, absent=action in ("prepare", "read", "inspect"))
        if action == "prepare":
            binding_json, roots, reserved = request.get("bindingJSON"), request.get("roots"), request.get("reservedPaths")
            need(isinstance(binding_json, str) and digest(binding_json.encode("utf-8")) == expected and
                 isinstance(roots, list) and 0 < len(roots) <= 128 and isinstance(reserved, list),
                 "HOST_ADOPTION_BINDING_INVALID")
            binding = json.loads(binding_json)
            need(binding.get("roots") == roots and binding.get("adoption", {}).get("directory") == directory,
                 "HOST_ADOPTION_BINDING_CHANGED")
            for root in roots:
                check_root(root)
            need(len({r["name"] for r in roots}) == len(roots), "HOST_ADOPTION_DUPLICATE_ROOT")
            for path in reserved:
                absolute(path)
                need(not overlaps(directory, path), "HOST_ADOPTION_CONTROL_OVERLAP")
            if value is None:
                token, created_at = operation_token(operation)
                value = {"schema": SCHEMA, "directory": directory, "directoryIdentity": identity(os.fstat(operation)),
                         "reviewSha256": expected, "bindingJSON": binding_json, "binding": binding,
                         "roots": roots, "reservedPaths": reserved, "token": token, "createdAt": created_at}
                retain(operation, "adoption.json", value)
            else:
                need(value["bindingJSON"] == binding_json and value["roots"] == roots and
                     value["reservedPaths"] == reserved, "HOST_ADOPTION_BINDING_CHANGED")
                retain(operation, "adoption.json", value)
        if action in ("read", "prepare"):
            return operation_summary(operation, value)
        if action == "inspect":
            result = operation_summary(operation, value)
            if value is not None:
                result["stages"] = [status_root(operation, value, root) for root in value["roots"]]
            return result
        need(value is not None, "HOST_ADOPTION_OPERATION_MISSING")
        if action == "inspectRoot":
            root = request.get("root")
            need(root in value["roots"], "HOST_ADOPTION_ROOT_CHANGED")
            return status_root(operation, value, root)
        if action == "publish":
            return publish(operation, directory, value, request["root"], request["entriesJSON"], request["entriesSha256"])
        result = request.get("result")
        need(isinstance(result, dict) and result.get("reviewSha256") == expected and
             result.get("status") == "HOST_HANDOFF_ADOPTED", "HOST_ADOPTION_RESULT_INVALID")
        return retain_completion(operation, expected, result)
    finally:
        named_directory(directory, operation)
        os.close(operation)

if __name__ == "__main__":
    try:
        need(sys.platform.startswith("linux"), "HOST_ADOPTION_REQUIRES_LINUX")
        parent_pid = int(sys.argv[1])
        # Parent death aborts this worker; fd3 retains the ORIGINAL flock until exit.
        need(libc.prctl(1, signal.SIGTERM, 0, 0, 0) == 0, "HOST_ADOPTION_PARENT_GUARD_FAILED")
        need(os.getppid() == parent_pid, "HOST_ADOPTION_PARENT_GONE")
        raw = sys.stdin.buffer.read(MAX_JSON + 1)
        need(len(raw) <= MAX_JSON, "HOST_ADOPTION_INPUT_LIMIT")
        response = {"ok": True, "value": main(json.loads(raw.decode("utf-8")))}
        sys.stdout.buffer.write(raw_json(response))
    except BaseException as error:
        code = str(error) if isinstance(error, RuntimeError) else "HOST_ADOPTION_" + type(error).__name__.upper()
        sys.stdout.buffer.write(raw_json({"ok": False, "code": code}))
        sys.exit(1)
