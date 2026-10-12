#!/usr/bin/env python3
"""Capture and adopt a completed original paid-jobs core through its existing lease.

This is a private source/state carrier for the existing CloudJobs operation.
It creates no worker, payment, execution queue or replacement merchant identity.
"""
from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import tempfile

SCHEMA = "stellar-forge.paid-job-native-completed-core.v1"
OPERATION = "SCF-DURABLE-PAID-JOBS-0B8D-20261011"
MAXIMUM = 256 * 1024 * 1024
HASH = re.compile(r"[a-f0-9]{64}")
JOBS = ("report:2026.10", "recovery:2026.10")


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def canonical_path(value):
    path = Path(value)
    require(path.is_absolute() and str(path) == str(value) and
            path.resolve() == path, "ORIGINAL_CANONICAL_PATH_REQUIRED:" + str(value))
    return path


def regular(path, maximum=MAXIMUM):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "ORIGINAL_REGULAR_FILE_REQUIRED:" + str(path))
        value = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require(len(value) <= maximum and
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "ORIGINAL_FILE_CHANGED:" + str(path))
        return value


def private_directory(path):
    path = canonical_path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
            "PRIVATE_OWNED_DIRECTORY_REQUIRED:" + str(path))
    return path


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def immutable(path, value):
    path = Path(path)
    private_directory(path.parent)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(regular(path) == value, "ORIGINAL_CARRIER_DESTINATION_CHANGED:" + str(path))
        return
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)


def descriptor(name, value):
    return {"path": name, "bytes": len(value), "sha256": digest(value)}


def core_result(raw, retained):
    value = json.loads(raw)
    require(value.get("result") == "PASS" and value.get("retainedWorkDirectory") == str(retained) and
            value.get("nativeSettlements") == 2 and value.get("nativeVerifies") == 2 and
            {item.get("jobId") for item in value.get("jobs", [])} == set(JOBS),
            "COMPLETED_ORIGINAL_CORE_RESULT_REQUIRED")
    return value


def state_binding(files, application, retained):
    source = json.loads(files["merchant-state/source.json"])["source"]
    config = json.loads(files["merchant.json"])
    require(source.get("configSha256") == digest(files["merchant.json"]) and
            files["merchant-state/config-source.json"] == files["merchant.json"] and
            source.get("application") == application["path"] and
            source.get("applicationSha256") == application["sha256"] and
            digest(files["merchant-state/application-source.mjs"]) == application["sha256"] and
            source.get("publicOrigin") == config.get("publicOrigin"),
            "COMPLETED_CORE_SOURCE_CHANGED")
    lexical = os.path.normpath(os.path.join(str(retained), config["application"]))
    require(lexical == application["entryPath"], "ORIGINAL_APPLICATION_ENTRY_CHANGED")
    jobs = []
    for job_id in JOBS:
        row = json.loads(files["merchant-state/records/" + job_id + ".json"])
        require(row["id"] == job_id and row["state"] == "COMPLETED" and
                row["submittedAt"] is not None and row["settlement"] is not None and
                row["source"] == source, "COMPLETED_ORIGINAL_JOB_REQUIRED:" + job_id)
        result = row["result"]
        require(HASH.fullmatch(result["sha256"]) and result["file"] == result["sha256"] + ".bin",
                "ORIGINAL_JOB_RESULT_IDENTITY_CHANGED:" + job_id)
        body = files["merchant-state/results/" + result["file"]]
        require(len(body) == result["bytes"] and digest(body) == result["sha256"],
                "ORIGINAL_JOB_RESULT_BYTES_CHANGED:" + job_id)
        jobs.append({"jobId": job_id, "state": row["state"], "revision": row["revision"],
                     "inputSha256": row["inputSha256"], "resultSha256": result["sha256"],
                     "resultBytes": result["bytes"], "nativeSettlementId": row["settlement"]["id"]})
    return {"source": source, "jobs": jobs}


def capture_completed_core(*, retained, result_path, result_sha256, output, native_record):
    retained = canonical_path(retained)
    result_path = canonical_path(result_path)
    native_record = canonical_path(native_record)
    require(HASH.fullmatch(result_sha256), "EXACT_ORIGINAL_CORE_RESULT_HASH_REQUIRED")
    raw_result = regular(result_path, 1048576)
    require(digest(raw_result) == result_sha256, "COMPLETED_CORE_RESULT_HASH_CHANGED")
    core_result(raw_result, retained)
    output = Path(output)
    require(output.is_absolute() and output.parent.resolve() == output.parent and
            not output.is_relative_to(retained), "CAPSULE_OUTPUT_OUTSIDE_RETAINED_STATE_REQUIRED")
    private_directory(output.parent)
    lease = os.open(retained / "merchant-state/lease.lock", os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = json.loads(regular(retained / "merchant.json", 1048576))
        entry_path = Path(os.path.normpath(os.path.join(str(retained), config["application"])))
        application_path = entry_path.resolve(strict=True)
        application_bytes = regular(application_path, 4194304)
        application = {"path": str(application_path), "entryPath": str(entry_path),
                       "bytes": len(application_bytes), "sha256": digest(application_bytes)}
        files, links, total = {}, [], len(raw_result) + len(application_bytes)
        for path in sorted(retained.rglob("*")):
            relative = path.relative_to(retained).as_posix()
            if path.is_symlink():
                require(path == entry_path and path.resolve(strict=True) == application_path,
                        "ORIGINAL_RETAINED_LINK_REQUIRES_SOURCE:" + relative)
                links.append({"path": relative, "target": os.readlink(path), "resolvedPath": str(application_path)})
                continue
            if path.is_dir():
                continue
            value = regular(path)
            total += len(value)
            require(total <= MAXIMUM and len(files) < 49996, "COMPLETED_CORE_CAPSULE_LIMIT")
            files[relative] = value
        binding = state_binding(files, application, retained)
        # Read back the same original files under the acquired merchant lease.
        for relative, value in files.items():
            require(regular(retained / relative) == value, "ORIGINAL_STATE_CHANGED_DURING_CAPTURE:" + relative)
        require(regular(application_path) == application_bytes and regular(result_path) == raw_result,
                "ORIGINAL_CORE_SOURCE_CHANGED_DURING_CAPTURE")
        manifest = {"schema": SCHEMA, "operation": OPERATION, "retainedDirectory": str(retained),
                    "application": application, "links": links, **binding,
                    "coreResult": {"sourcePath": str(result_path), "nativeRecordDirectory": str(native_record),
                                   "bytes": len(raw_result), "sha256": result_sha256},
                    "files": [descriptor(name, value) for name, value in files.items()]}
        entries = {"retained/" + name: value for name, value in files.items()}
        entries["core/native-result.json"] = raw_result
        entries["source/application.mjs"] = application_bytes
        entries["capsule.json"] = encoded(manifest)
        require(len(entries["capsule.json"]) <= 4 * 1024 * 1024, "COMPLETED_CAPSULE_MANIFEST_LIMIT")
        buffer = io.BytesIO()
        with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for name, value in sorted(entries.items()):
                    member = tarfile.TarInfo(name)
                    member.mode, member.size, member.mtime = 0o600, len(value), 0
                    archive.addfile(member, io.BytesIO(value))
        capsule = buffer.getvalue()
        require(len(capsule) <= MAXIMUM, "COMPLETED_CORE_ARCHIVE_LIMIT")
        immutable(output, capsule)
        return {"path": str(output), "bytes": len(capsule), "sha256": digest(capsule),
                "schema": SCHEMA, "operation": OPERATION, "manifest": manifest,
                "scope": "PRIVATE_COMPLETED_ORIGINAL_CORE"}
    finally:
        os.close(lease)


def read_completed_capsule(path, expected):
    require(HASH.fullmatch(expected), "EXACT_COMPLETED_CAPSULE_HASH_REQUIRED")
    raw = regular(path)
    require(digest(raw) == expected, "COMPLETED_CAPSULE_HASH_CHANGED")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        require(len(names) <= 50000 and len(names) == len(set(names)) and
                all(member.isfile() and member.size >= 0 for member in members) and
                "capsule.json" in names, "COMPLETED_CAPSULE_MEMBERS_INVALID")
        require(archive.getmember("capsule.json").size <= 4 * 1024 * 1024,
                "COMPLETED_CAPSULE_MANIFEST_LIMIT")
        manifest = json.load(archive.extractfile("capsule.json"))
        require(manifest.get("schema") == SCHEMA and manifest.get("operation") == OPERATION,
                "COMPLETED_CAPSULE_IDENTITY_CHANGED")
        retained = canonical_path(manifest["retainedDirectory"])
        application = manifest["application"]
        canonical_path(application["path"])
        entry_path = Path(application["entryPath"])
        require(entry_path.is_absolute() and os.path.normpath(str(entry_path)) == str(entry_path),
                "ORIGINAL_APPLICATION_ENTRY_REQUIRED")
        descriptors, links = manifest["files"], manifest["links"]
        require(isinstance(descriptors, list) and isinstance(links, list) and len(links) <= 1,
                "COMPLETED_CAPSULE_FILES_INVALID")
        files, wanted, total = {}, {"capsule.json", "source/application.mjs", "core/native-result.json"}, 0
        for item in descriptors:
            relative = PurePosixPath(item["path"])
            require(relative.parts and not relative.is_absolute() and relative.as_posix() == item["path"] and
                    all(part not in (".", "..") for part in relative.parts) and item["path"] not in files and
                    type(item["bytes"]) is int and item["bytes"] >= 0 and HASH.fullmatch(item["sha256"]),
                    "COMPLETED_CAPSULE_FILE_DESCRIPTOR_INVALID")
            total += item["bytes"]
            require(total <= MAXIMUM, "COMPLETED_CAPSULE_SIZE_LIMIT")
            name = "retained/" + item["path"]
            member = archive.getmember(name)
            require(member.size == item["bytes"], "COMPLETED_CAPSULE_MEMBER_SIZE_CHANGED")
            data = archive.extractfile(member).read(item["bytes"] + 1)
            require(len(data) == item["bytes"] and digest(data) == item["sha256"],
                    "COMPLETED_CAPSULE_MEMBER_HASH_CHANGED")
            files[item["path"]] = data
            wanted.add(name)
        require(set(names) == wanted, "COMPLETED_CAPSULE_UNEXPECTED_MEMBER")
        for link in links:
            relative = PurePosixPath(link["path"])
            require(not relative.is_absolute() and relative.parts and relative.as_posix() == link["path"] and
                    all(part not in (".", "..") for part in relative.parts) and link["path"] not in files and
                    retained / link["path"] == entry_path and link["resolvedPath"] == application["path"] and
                    os.path.normpath(os.path.join(str(entry_path.parent), link["target"])) == application["path"],
                    "ORIGINAL_APPLICATION_LINK_CHANGED")
        app_member = archive.getmember("source/application.mjs")
        core_member = archive.getmember("core/native-result.json")
        require(app_member.size == application["bytes"] <= 4194304 and
                core_member.size == manifest["coreResult"]["bytes"] <= 1048576,
                "COMPLETED_CORE_SOURCE_LIMIT")
        application_bytes = archive.extractfile(app_member).read(4194305)
        raw_result = archive.extractfile(core_member).read(1048577)
        require(digest(application_bytes) == application["sha256"] and
                digest(raw_result) == manifest["coreResult"]["sha256"], "COMPLETED_CORE_SOURCE_HASH_CHANGED")
        require(total + len(application_bytes) + len(raw_result) <= MAXIMUM, "COMPLETED_CAPSULE_SIZE_LIMIT")
        core_result(raw_result, retained)
        binding = state_binding(files, application, retained)
        require(binding["source"] == manifest["source"] and binding["jobs"] == manifest["jobs"],
                "COMPLETED_CORE_STATE_BINDING_CHANGED")
        canonical_path(manifest["coreResult"]["sourcePath"])
        canonical_path(manifest["coreResult"]["nativeRecordDirectory"])
        if application["path"].startswith(str(retained) + "/"):
            relative = Path(application["path"]).relative_to(retained).as_posix()
            require(files.get(relative) == application_bytes, "ORIGINAL_INTERNAL_APPLICATION_CHANGED")
        elif entry_path != Path(application["path"]):
            require(len(links) == 1, "ORIGINAL_EXTERNAL_APPLICATION_LINK_REQUIRED")
        return {"manifest": manifest, "files": files, "applicationBytes": application_bytes,
                "coreResultBytes": raw_result, "archiveSha256": expected}


def restore_completed_capsule(capsule, workspace):
    manifest = capsule["manifest"]
    retained = canonical_path(manifest["retainedDirectory"])
    workspace = private_directory(workspace)
    binding = {"archiveSha256": capsule["archiveSha256"], "manifest": manifest}
    binding_path = workspace / "input-capsule.json"
    if binding_path.exists():
        require(json.loads(regular(binding_path)) == binding, "ORIGINAL_COMPLETED_INPUT_CAPSULE_CHANGED")
        require(retained.is_dir(), "RESTORE_ORIGINAL_COMPLETED_DIRECTORY")
        # The same resumed worker may have advanced customer state. Preserve it.
        application = Path(manifest["application"]["path"])
        require(regular(application, 4194304) == capsule["applicationBytes"],
                "ORIGINAL_COMPLETED_APPLICATION_CHANGED")
        return manifest
    private_directory(retained)
    application = Path(manifest["application"]["path"])
    immutable(application, capsule["applicationBytes"])
    for relative, value in capsule["files"].items():
        immutable(retained / relative, value)
    for link in manifest["links"]:
        path = retained / link["path"]
        private_directory(path.parent)
        try:
            os.symlink(link["target"], path)
            sync_directory(path.parent)
        except FileExistsError:
            require(path.is_symlink() and os.readlink(path) == link["target"],
                    "ORIGINAL_APPLICATION_LINK_DESTINATION_CHANGED")
    require(Path(manifest["application"]["entryPath"]).resolve(strict=True) == application,
            "RESTORED_APPLICATION_REALPATH_CHANGED")
    actual = {path.relative_to(retained).as_posix() for path in retained.rglob("*")
              if path.is_file() or path.is_symlink()}
    expected = set(capsule["files"]) | {link["path"] for link in manifest["links"]}
    require(actual == expected, "EXISTING_COMPLETED_RETAINED_DIRECTORY_DIFFERS")
    immutable(binding_path, encoded(binding))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--retained", type=Path, required=True)
    parser.add_argument("--core-result", type=Path, required=True)
    parser.add_argument("--core-result-sha256", required=True)
    parser.add_argument("--native-record", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = capture_completed_core(retained=args.retained, result_path=args.core_result,
                                    result_sha256=args.core_result_sha256, output=args.out,
                                    native_record=args.native_record)
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == "__main__":
    os.umask(0o077)
    main()
