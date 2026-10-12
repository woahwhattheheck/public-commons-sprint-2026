#!/usr/bin/env python3
"""Run the original Europe PMC operator, cold reopen and complete source delivery."""
from __future__ import annotations

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

SCHEMA = "stellar-forge.europe-pmc-native-receiving.v1"
PREFIX = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers"
LIMIT = 256 * 1024 * 1024


def need(value, code):
    if not value:
        raise ValueError(code)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_file(path, limit=LIMIT):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        need(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "EUROPE_PMC_NATIVE_FILE_INVALID")
        with os.fdopen(os.dup(descriptor), "rb") as stream:
            data = stream.read(limit + 1)
        need(len(data) <= limit, "EUROPE_PMC_NATIVE_FILE_TOO_LARGE")
        return data
    finally:
        os.close(descriptor)


def atomic(path, data, exclusive=False):
    handle, name = tempfile.mkstemp(prefix=".epmc-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            try:
                os.link(name, path)
            except FileExistsError:
                need(read_file(path) == data, "EUROPE_PMC_NATIVE_RETAINED_FILE_CHANGED")
        else:
            os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_mode & 0o077 == 0
         and info.st_uid == os.getuid() and path.resolve() == path,
         "EUROPE_PMC_NATIVE_PRIVATE_DIRECTORY_REQUIRED")
    return path


def process_identity(pid):
    try:
        value = Path("/proc", str(pid), "stat").read_text()
        tail = value[value.rfind(")") + 2:].split()
        return {"pid": pid, "start_ticks": tail[19], "state": tail[0]}
    except FileNotFoundError:
        return None


def process_alive(selected):
    if not selected:
        return False
    actual = process_identity(selected["pid"])
    return bool(actual and actual["start_ticks"] == selected["start_ticks"] and actual["state"] != "Z")


def source_selection(root, manifest_path):
    original = read_file(manifest_path, 32 * 1024 * 1024)
    value = json.loads(original)
    rows = value.get("files")
    need(isinstance(rows, list) and rows, "EUROPE_PMC_NATIVE_COMPLETE_SOURCE_REQUIRED")
    selected, seen = [], set()
    for row in rows:
        relative = row.get("path")
        need(isinstance(relative, str), "EUROPE_PMC_NATIVE_SOURCE_PATH_INVALID")
        member = PurePosixPath(relative)
        need(not member.is_absolute() and ".." not in member.parts and "\\" not in relative
             and relative not in seen, "EUROPE_PMC_NATIVE_SOURCE_PATH_INVALID")
        seen.add(relative)
        path = root.joinpath(*member.parts)
        need(path.resolve().is_relative_to(root), "EUROPE_PMC_NATIVE_SOURCE_PATH_INVALID")
        body = read_file(path)
        need(len(body) == row["bytes"] and digest(body) == row["sha256"],
             "EUROPE_PMC_NATIVE_COMPLETE_SOURCE_CHANGED")
        selected.append({"path": relative, "bytes": len(body), "sha256": digest(body)})
    need(PREFIX + "/europe-pmc-native.mjs" in seen and PREFIX + "/europe-pmc-journey.mjs" in seen,
         "EUROPE_PMC_NATIVE_RECEIVING_SOURCE_MISSING")
    return {"manifestSha256": digest(original), "files": sorted(selected, key=lambda item: item["path"])}


def child_setup(parent_pid):
    # The original lock descriptor is inherited as well. A lost launcher signals
    # this exact child; Node drains its original browser and listener on SIGTERM.
    os.setsid()
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.prctl(1, signal.SIGTERM, 0, 0, 0) == 0, "EUROPE_PMC_NATIVE_PARENT_LIFETIME_REQUIRED")
    if os.getppid() != parent_pid:
        os.kill(os.getpid(), signal.SIGTERM)


def run_phase(phase, args, selection_file, lock_fd, journal, save):
    run = args.directory
    result_file = run / (phase + "-result.private.json")
    selected_sha = digest(read_file(selection_file))
    previous = journal.get("phases", {}).get(phase)
    if result_file.exists():
        result = json.loads(read_file(result_file))
        need(result["phase"] == phase and result["selectionSha256"] == selected_sha,
             "EUROPE_PMC_NATIVE_PHASE_RESULT_CHANGED")
        for item in result["result"]["nativeOutputs"]:
            path = Path(item["path"])
            need(path.is_relative_to(run), "EUROPE_PMC_NATIVE_OUTPUT_OUTSIDE_OPERATION")
            body = read_file(path)
            need(len(body) == item["bytes"] and digest(body) == item["sha256"],
                 "EUROPE_PMC_NATIVE_OUTPUT_CHANGED")
        journal.setdefault("phases", {})[phase] = {
            **(previous or {}), "state": "COMPLETE", "resultSha256": digest(read_file(result_file)),
            "resultObservedAt": time.time()}
        save()
        return result

    need(not previous or not process_alive(previous.get("process")),
         "EUROPE_PMC_NATIVE_ORIGINAL_CHILD_STILL_RUNNING")
    attempts = list((previous or {}).get("attempts", []))
    if previous:
        attempts.append({**previous, "attempts": [], "observedEndedWithoutResultAt": time.time()})
    command = [str(args.node), str(args.source_root / PREFIX / "europe-pmc-native.mjs"),
               "--phase", phase, "--selection", str(selection_file)]
    record = {"state": "PREPARED", "argv": command, "preparedAt": time.time(),
              "selectionSha256": selected_sha, "attempts": attempts}
    journal.setdefault("phases", {})[phase] = record
    save()
    child = None
    log_file = run / (phase + "-process.private.log")
    try:
        parent_pid = os.getpid()
        with open(log_file, "ab", buffering=0) as log:
            child = subprocess.Popen(
                command, cwd=args.source_root, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                pass_fds=(lock_fd,), preexec_fn=lambda: child_setup(parent_pid))
            # All launch/identity persistence is inside this cleanup lifetime.
            record["process"] = process_identity(child.pid)
            record["startedAt"] = time.time()
            record["state"] = "RUNNING"
            save()
            code = child.wait()
        record["exitCode"] = code
        record["endedAt"] = time.time()
        record["state"] = "ENDED"
        save()
        need(code == 0 and result_file.exists(), "EUROPE_PMC_NATIVE_PHASE_FAILED_" + phase.upper())
        result = json.loads(read_file(result_file))
        need(result["phase"] == phase and result["selectionSha256"] == selected_sha,
             "EUROPE_PMC_NATIVE_PHASE_RESULT_CHANGED")
        record["state"] = "COMPLETE"
        record["resultSha256"] = digest(read_file(result_file))
        save()
        return result
    finally:
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()


def package_delivery(args, sources, phases, journal, save):
    prepared_path = args.directory / "delivery-prepared.private.json"
    archive_path = args.directory / "Europe_PMC_Complete_Receiving.zip"
    receipt_path = args.directory / "complete-delivery.json"
    if prepared_path.exists():
        prepared = json.loads(read_file(prepared_path, 32 * 1024 * 1024))
    else:
        members = []
        for row in sources["files"]:
            members.append({"name": "source/" + row["path"], "path": str(args.source_root / row["path"]),
                            "bytes": row["bytes"], "sha256": row["sha256"]})
        artifacts = {}
        for phase in phases:
            for row in phase["result"]["nativeOutputs"]:
                path = Path(row["path"])
                need(path.is_relative_to(args.directory), "EUROPE_PMC_NATIVE_OUTPUT_OUTSIDE_OPERATION")
                key = "receiving/" + row["filename"]
                old = artifacts.get(key)
                item = {"name": key, "path": str(path), "bytes": row["bytes"], "sha256": row["sha256"]}
                need(old is None or old == item, "EUROPE_PMC_NATIVE_ARTIFACT_IDENTITY_CHANGED")
                artifacts[key] = item
        members.extend(artifacts.values())
        summary = {
            "schema": SCHEMA, "operationId": args.operation_id,
            "sourceManifestSha256": sources["manifestSha256"],
            "phases": [{"phase": phase["phase"], "workspaceId": phase["workspaceId"],
                        "instanceId": phase["instanceId"], "completedAt": phase["completedAt"],
                        "result": {key: value for key, value in phase["result"].items()
                                   if key != "nativeOutputs"}} for phase in phases],
            "receiving": "Original source intake, browser operation, dossier append, portable library "
                         "restore and a separate fresh Node process completed.",
        }
        need(phases[0]["instanceId"] != phases[1]["instanceId"],
             "EUROPE_PMC_NATIVE_FRESH_PROCESS_REQUIRED")
        summary_path = args.directory / "completed-native-operation.json"
        atomic(summary_path, encoded(summary), exclusive=True)
        members.append({"name": "receiving/completed-native-operation.json", "path": str(summary_path),
                        "bytes": summary_path.stat().st_size, "sha256": digest(read_file(summary_path))})
        manifest = {
            "schema": "stellar-forge.europe-pmc-complete-delivery.v1",
            "operationId": args.operation_id, "sourceManifestSha256": sources["manifestSha256"],
            "members": [{key: row[key] for key in ("name", "bytes", "sha256")}
                        for row in sorted(members, key=lambda item: item["name"])]}
        prepared = {"manifest": manifest, "members": members, "fingerprint": digest(encoded(manifest))}
        atomic(prepared_path, encoded(prepared), exclusive=True)

    need(prepared["manifest"]["operationId"] == args.operation_id
         and prepared["manifest"]["sourceManifestSha256"] == sources["manifestSha256"],
         "EUROPE_PMC_NATIVE_DELIVERY_SELECTION_CHANGED")
    names = [row["name"] for row in prepared["members"]]
    need(len(names) == len(set(names)), "EUROPE_PMC_NATIVE_DELIVERY_DUPLICATE_MEMBER")
    manifest_bytes = encoded(prepared["manifest"])

    def verify_archive():
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.infolist()
            expected = set(names) | {"DELIVERY_MANIFEST.json"}
            need(len(entries) == len(expected) and {row.filename for row in entries} == expected,
                 "EUROPE_PMC_NATIVE_DELIVERY_INVENTORY_CHANGED")
            need(archive.read("DELIVERY_MANIFEST.json") == manifest_bytes,
                 "EUROPE_PMC_NATIVE_DELIVERY_MANIFEST_CHANGED")
            for row in prepared["members"]:
                body = archive.read(row["name"])
                need(len(body) == row["bytes"] and digest(body) == row["sha256"],
                     "EUROPE_PMC_NATIVE_DELIVERY_MEMBER_CHANGED")

    if not archive_path.exists():
        handle, candidate_name = tempfile.mkstemp(prefix=".epmc-delivery-", dir=args.directory)
        os.close(handle)
        try:
            with zipfile.ZipFile(candidate_name, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for row in sorted(prepared["members"], key=lambda item: item["name"]):
                    body = read_file(Path(row["path"]))
                    need(len(body) == row["bytes"] and digest(body) == row["sha256"],
                         "EUROPE_PMC_NATIVE_DELIVERY_SOURCE_CHANGED")
                    entry = zipfile.ZipInfo(row["name"], (1980, 1, 1, 0, 0, 0))
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    entry.external_attr = 0o100644 << 16
                    archive.writestr(entry, body)
                entry = zipfile.ZipInfo("DELIVERY_MANIFEST.json", (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, manifest_bytes)
            with open(candidate_name, "rb") as stream:
                os.fsync(stream.fileno())
            try:
                os.link(candidate_name, archive_path)
            except FileExistsError:
                pass
        finally:
            os.unlink(candidate_name)
    # The original complete ZIP is authoritative after a lost receipt write.
    verify_archive()
    archive_bytes = read_file(archive_path)
    receipt = {"schema": "stellar-forge.europe-pmc-complete-delivery-receipt.v1",
               "operationId": args.operation_id, "filename": archive_path.name,
               "bytes": len(archive_bytes), "sha256": digest(archive_bytes),
               "manifestSha256": digest(manifest_bytes), "fingerprint": prepared["fingerprint"],
               "members": len(names) + 1}
    atomic(receipt_path, encoded(receipt), exclusive=True)
    journal["state"] = "COMPLETE"
    journal["delivery"] = receipt
    save()
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--dossier", required=True)
    parser.add_argument("--expected-revision", required=True, type=int)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--playwright", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    args = parser.parse_args()
    need(sys.platform == "linux", "EUROPE_PMC_NATIVE_LINUX_REQUIRED")
    need(args.operation_id and len(args.operation_id) <= 160 and args.expected_revision >= 1,
         "EUROPE_PMC_NATIVE_OPERATION_SELECTION_INVALID")
    for name in ("source_root", "source_manifest", "workspace", "directory", "inputs", "node", "playwright", "chromium"):
        path = getattr(args, name)
        need(path.is_absolute() and path.resolve() == path, "EUROPE_PMC_NATIVE_ABSOLUTE_PATH_REQUIRED")
    private_directory(args.directory)
    sources = source_selection(args.source_root, args.source_manifest)
    selection = {"schema": "stellar-forge.europe-pmc-native-selection.v1",
                 "operationId": args.operation_id, "sourceManifestSha256": sources["manifestSha256"],
                 "workspaceDirectory": str(args.workspace), "dossierId": args.dossier,
                 "expectedRevision": args.expected_revision, "runDirectory": str(args.directory),
                 "inputDirectory": str(args.inputs), "playwrightModule": str(args.playwright),
                 "chromiumExecutable": str(args.chromium), "pythonExecutable": sys.executable}
    selected_path = args.directory / "native-selection.private.json"
    control = args.directory / "native-receiving.private.json"
    lock_path = args.directory / "native-receiving.lock"
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock_fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_mode & 0o077 == 0,
             "EUROPE_PMC_NATIVE_LIFETIME_LOCK_CHANGED")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        atomic(selected_path, encoded(selection), exclusive=True)
        if control.exists():
            journal = json.loads(read_file(control, 8 * 1024 * 1024))
            need(journal["operationId"] == args.operation_id and journal["selectionSha256"] == digest(encoded(selection)),
                 "EUROPE_PMC_NATIVE_ORIGINAL_OPERATION_CHANGED")
        else:
            journal = {"schema": SCHEMA, "operationId": args.operation_id,
                       "selectionSha256": digest(encoded(selection)), "state": "PREPARED",
                       "preparedAt": time.time(), "phases": {}}

        def save():
            atomic(control, encoded(journal))

        save()
        phases = [run_phase(phase, args, selected_path, lock_fd, journal, save)
                  for phase in ("operate", "reopen")]
        receipt = package_delivery(args, sources, phases, journal, save)
        print(json.dumps(receipt))
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
