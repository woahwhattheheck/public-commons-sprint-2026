#!/usr/bin/env python3
"""Observe an interrupted or definitively unstarted original Node attempt.

This read-only helper supplies process evidence to the original authenticated
Governor check. It neither grants approval nor establishes absence of payment.
The caller pins its private operation, review, attempt and installed native
runtime. No shell, remote service, wallet or replacement operation is invoked.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.dont_write_bytecode = True
SCHEMA = "stellar-forge.node-preapproval-process-proof.v1"
REQUEST_SCHEMA = "stellar-forge.node-preapproval-process-proof-request.v1"
IDENTITY_SCHEMA = "stellar-forge.node-process-identity.v1"
NATIVE_START_SCHEMA = "stellar-forge.node-native-start-receipt.v1"
SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_FILE = 16 * 1024 * 1024
ATTEMPT_LIMIT = 65536
RESERVED_REQUEST_LIMIT = 2097152
REVIEWED_BOOTSTRAP_SHA256 = "aabc20e221b269957ff9e32115500980d27e32e3292ad9e338c7a1fff9eddac4"


class ProofError(ValueError):
    pass


def need(condition, code):
    if not condition:
        raise ProofError(code)


def absolute(value):
    need(isinstance(value, str) and value.startswith("/") and "\0" not in value,
         "ABSOLUTE_ORIGINAL_PATH_REQUIRED")
    path = Path(value).resolve(strict=True)
    need(str(path) == value, "ORIGINAL_CANONICAL_PATH_REQUIRED")
    return path


def contained(path, root):
    return path == root or root in path.parents


def stable_bytes(path, expected=None, limit=MAX_FILE):
    if expected is not None:
        need(isinstance(expected, str) and SHA.fullmatch(expected), "EXACT_SOURCE_SHA256_REQUIRED")
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
             "BOUNDED_REGULAR_SOURCE_REQUIRED")
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size,
                              value.st_mtime_ns, value.st_ctime_ns)
    need(identity(before) == identity(after) and len(raw) == before.st_size,
         "SOURCE_CHANGED_DURING_READ")
    digest = hashlib.sha256(raw).hexdigest()
    need(expected is None or digest == expected, "ORIGINAL_SOURCE_SHA256_MISMATCH")
    return raw, {"path": str(path), "sha256": digest, "bytes": len(raw),
                 "device": before.st_dev, "inode": before.st_ino}


def parse(raw):
    value = json.loads(raw)
    need(isinstance(value, dict), "JSON_OBJECT_REQUIRED")
    return value


def instant(value):
    need(isinstance(value, str), "ORIGINAL_TIMESTAMP_REQUIRED")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    need(parsed.tzinfo is not None, "ORIGINAL_TIMESTAMP_ZONE_REQUIRED")
    return parsed


def confirm_bindings(bindings):
    for binding in bindings.values():
        _, current = stable_bytes(Path(binding["path"]), binding["sha256"])
        need(current == binding, "ORIGINAL_SOURCE_IDENTITY_CHANGED")


def proc_status(path):
    raw = (path / "stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    need(len(fields) >= 20, "PROCFS_STAT_INCOMPLETE")
    nspids = None
    for line in (path / "status").read_text().splitlines():
        if line.startswith("NSpid:"):
            nspids = [int(value) for value in line.partition(":")[2].split()]
    need(nspids and nspids[0] == int(raw.partition(" ")[0]),
         "PROCFS_NAMESPACE_VISIBILITY_REQUIRED")
    return {"proc_pid": nspids[0], "pid": nspids[-1], "nspids": nspids,
            "start_ticks": fields[19], "state": fields[0]}


def process_absent(identity, boot_id):
    need(isinstance(identity, dict) and type(identity.get("proc_pid")) is int and
         identity["proc_pid"] > 0 and type(identity.get("pid")) is int and identity["pid"] > 0 and
         isinstance(identity.get("start_ticks"), str) and identity["start_ticks"].isdecimal() and
         isinstance(identity.get("boot_id"), str) and
         isinstance(identity.get("namespace"), str) and
         re.fullmatch(r"pid:\[\d+\]", identity["namespace"]), "ORIGINAL_KERNEL_IDENTITY_REQUIRED")
    if identity["boot_id"] != boot_id:
        return {"outcome": "ORIGINAL_BOOT_ENDED"}
    try:
        current = proc_status(Path("/proc") / str(identity["proc_pid"]))
    except (FileNotFoundError, ProcessLookupError):
        return {"outcome": "ORIGINAL_PROCFS_ENTRY_ABSENT"}
    if current["state"] in ("Z", "X"):
        return {"outcome": "ORIGINAL_PROCESS_EXITED", "observed": current}
    if current["start_ticks"] != identity["start_ticks"]:
        return {"outcome": "PROCFS_PID_REUSED", "observed": current}
    # Missing permission to follow a namespace link cannot make a matching
    # live kernel lifetime look absent. Boot, procfs PID and start already bind it.
    raise ProofError("ORIGINAL_NATIVE_PROCESS_STILL_ALIVE")


def legacy_pid_absent(pid, namespace, boot_id, original_boot):
    if boot_id != original_boot:
        return {"outcome": "ORIGINAL_BOOT_ENDED", "observedProcesses": 0}
    current = proc_status(Path("/proc/self"))
    root = proc_status(Path("/proc/1"))
    need(current["pid"] == os.getpid() and root["nspids"] == [1],
         "COMPLETE_PROCFS_SCOPE_REQUIRED")
    mounts = []
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        before, separator, after = line.partition(" - ")
        if separator and before.split()[4] == "/proc" and after.split()[0] == "proc":
            mounts.append(before.split()[5].split(",") + after.split()[2].split(","))
    need(len(mounts) == 1 and not any(option.startswith("hidepid=") and
         option not in ("hidepid=0", "hidepid=off") for option in mounts[0]),
         "UNHIDDEN_PROCFS_SCOPE_REQUIRED")
    observed = unrelated = 0
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            item = proc_status(path)
            if item["state"] in ("Z", "X"):
                continue
            observed += 1
            if item["pid"] != pid:
                continue
            actual_namespace = os.readlink(path / "ns/pid")
            confirmed = proc_status(path)
            need(confirmed["start_ticks"] == item["start_ticks"], "PROCFS_CANDIDATE_CHANGED_REINSPECT")
            if confirmed["state"] in ("Z", "X"):
                continue
            need(actual_namespace != namespace, "ORIGINAL_ATTEMPT_PROCESS_STILL_ALIVE")
            unrelated += 1
        except (FileNotFoundError, ProcessLookupError):
            continue
    return {"outcome": "LEGACY_PID_ABSENT_FROM_ORIGINAL_NAMESPACE", "legacyPid": pid,
            "originalNamespace": namespace, "observedProcesses": observed,
            "otherNamespacePidMatches": unrelated, "observer": current,
            "observerNamespace": os.readlink("/proc/self/ns/pid"), "mountOptions": mounts[0]}


@contextmanager
def existing_record_lock(root):
    descriptor = os.open(root / ".lock", os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        yield stream


def result_base(intent_id, config_sha, bindings, directory, workspace):
    return {"schema": SCHEMA, "outcome": "ORIGINAL_ATTEMPT_PROCESS_ABSENT",
            "observedAt": datetime.now(timezone.utc).isoformat(), "intentId": intent_id,
            "configSha256": config_sha, "attemptSha256": bindings["attempt"]["sha256"],
            "operationDirectory": str(directory), "nativeWorkspace": str(workspace),
            "bindings": bindings,
            "authority": "PROCESS_OBSERVATION_ONLY_ORIGINAL_GOVERNOR_AND_FRESH_APPROVAL_REQUIRED"}


def recorded_identity_proof(selected, attempt, bindings, directory, workspace, intent_id, config_sha):
    identity = attempt.get("processIdentity")
    need(isinstance(identity, dict) and identity.get("schema") == IDENTITY_SCHEMA and
         identity.get("status") == "RECORDED" and identity.get("pid") == attempt.get("pid"),
         "ORIGINAL_RECORDED_IDENTITY_REQUIRED")
    if "processIdentity" in selected:
        need(selected["processIdentity"] == identity, "RECORDED_IDENTITY_INPUT_DIFFERS")
    parent = identity.get("parent")
    need(isinstance(parent, dict) and type(parent.get("procPid")) is int and parent["procPid"] > 0 and
         parent["procPid"] != identity.get("procPid") and isinstance(parent.get("startTicks"), str) and
         parent["startTicks"].isdecimal() and parent.get("namespace") == identity.get("namespace"),
         "ORIGINAL_RECORDED_PARENT_BINDING_REQUIRED")
    original = {"pid": identity.get("pid"), "proc_pid": identity.get("procPid"),
                "start_ticks": identity.get("startTicks"), "namespace": identity.get("namespace"),
                "boot_id": identity.get("bootId")}
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    # procPid belongs to the PID namespace represented by the original procfs
    # superblock. A different isolated /proc can hide a still-live host PID.
    # A changed boot conclusively ends the old lifetime; a same-boot observation
    # must use that same procfs superblock before treating ENOENT as absence.
    if original["boot_id"] == boot:
        need(isinstance(identity.get("procfsDevice"), str) and identity["procfsDevice"].isdecimal() and
             identity["procfsDevice"] == str(Path("/proc").stat().st_dev),
             "ORIGINAL_PROCFS_SCOPE_REQUIRED")
    # The application parent may still be alive after its child failed. Retain
    # its captured identity; the Governor owns the separate approval writer lock.
    observed = process_absent(original, boot)
    confirm_bindings(bindings)
    process_absent(original, boot)
    need(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == boot, "KERNEL_BOOT_CHANGED")
    result = result_base(intent_id, config_sha, bindings, directory, workspace)
    result.update(nativeRecord=None, procfs={"bootId": boot, "attempt": observed,
                                            "processIdentity": identity})
    return result


def compact_json(value):
    # Source bindings contain JSON objects with ASCII field names and integral
    # byte counts. This matches the runtime's recursively sorted JSON encoding.
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def reserved_start_command(command, operation, bindings, expected_args):
    runtime_name = operation.get("runtimeDirectory")
    need(isinstance(runtime_name, str) and Path(runtime_name).is_absolute() and
         "\0" not in runtime_name, "ORIGINAL_RESERVED_RUNTIME_REQUIRED")
    runtime = Path(runtime_name).resolve(strict=True)
    need(runtime.is_dir(), "ORIGINAL_RESERVED_RUNTIME_REQUIRED")
    bootstrap = absolute(command[1])
    need(bootstrap == (runtime / "node" / "reserved-entry.mjs").resolve(strict=True),
         "ORIGINAL_RESERVED_BOOTSTRAP_PATH_DIFFERS")
    _, bindings["reservedBootstrap"] = stable_bytes(
        bootstrap, REVIEWED_BOOTSTRAP_SHA256)
    request_path = absolute(command[2])
    need(request_path == Path(bindings["attempt"]["path"]).parent / "native-reserved-request.json" and
         isinstance(command[3], str) and SHA.fullmatch(command[3]),
         "ORIGINAL_RESERVED_REQUEST_BINDING_REQUIRED")
    raw, bindings["reservedRequest"] = stable_bytes(
        request_path, command[3], limit=RESERVED_REQUEST_LIMIT)
    request_stat = request_path.stat(follow_symlinks=False)
    request_binding = bindings["reservedRequest"]
    need(stat.S_ISREG(request_stat.st_mode) and request_stat.st_nlink == 1 and
         request_stat.st_uid == os.getuid() and request_stat.st_mode & 0o077 == 0 and
         request_stat.st_dev == request_binding["device"] and
         request_stat.st_ino == request_binding["inode"],
         "ORIGINAL_PRIVATE_RESERVED_REQUEST_REQUIRED")
    request = parse(raw)
    need(set(request).issubset({"schema", "entryFile", "entrySha256", "args",
                               "nativeFileReservation", "nativeRuntimeSource"}) and
         request.get("schema") == "stellar-forge.sf88.reserved-entry.v1" and
         request.get("args") == expected_args and
         isinstance(request.get("entrySha256"), str) and SHA.fullmatch(request["entrySha256"]),
         "ORIGINAL_RESERVED_ENTRY_BINDINGS_DIFFER")
    entry = absolute(request.get("entryFile"))
    need(entry == (runtime / "python" / "bridge.mjs").resolve(strict=True),
         "ORIGINAL_RESERVED_ENTRY_PATH_DIFFERS")
    _, bindings["reservedEntry"] = stable_bytes(entry, request["entrySha256"])

    provider = request.get("nativeFileReservation")
    need(isinstance(provider, dict) and
         set(provider) == {"schema", "executable", "executableSha256", "timeoutMs"} and
         provider.get("schema") == "stellar-forge.sf88.file-reservation.v1" and
         isinstance(provider.get("executableSha256"), str) and SHA.fullmatch(provider["executableSha256"]) and
         type(provider.get("timeoutMs")) is int and 0 < provider["timeoutMs"] <= 60000,
         "ORIGINAL_RESERVED_PROVIDER_REQUIRED")
    executable = absolute(provider["executable"])
    _, bindings["reservedAllocator"] = stable_bytes(executable, provider["executableSha256"])
    executable_stat = executable.stat(follow_symlinks=False)
    executable_binding = bindings["reservedAllocator"]
    need(stat.S_ISREG(executable_stat.st_mode) and executable_stat.st_mode & 0o111 and
         executable_stat.st_mode & 0o022 == 0 and
         executable_stat.st_dev == executable_binding["device"] and
         executable_stat.st_ino == executable_binding["inode"],
         "ORIGINAL_RESERVED_ALLOCATOR_CHANGED")

    if "nativeRuntimeSource" not in request:
        return
    source = request["nativeRuntimeSource"]
    fields = {"schema", "directory", "sourceDirectory", "sourceManifestFile",
              "sourceManifestSha256", "sourceManifestBytes", "filesSha256",
              "fileCount", "sourceBytes", "sha256"}
    need(isinstance(source, dict) and set(source) == fields and
         source.get("schema") == "stellar-forge.node-successor-runtime-binding.v1" and
         all(isinstance(source.get(name), str) and SHA.fullmatch(source[name])
             for name in ("sha256", "sourceManifestSha256", "filesSha256")) and
         all(type(source.get(name)) is int and source[name] > 0
             for name in ("sourceManifestBytes", "fileCount", "sourceBytes")) and
         source.get("directory") == str(runtime) and
         hashlib.sha256(compact_json({key: value for key, value in source.items()
                                     if key != "sha256"})).hexdigest() == source["sha256"],
         "ORIGINAL_RESERVED_RUNTIME_BINDING_CHANGED")
    source_directory = absolute(source["sourceDirectory"])
    need(source_directory.is_dir() and contained(runtime, source_directory),
         "ORIGINAL_RESERVED_RUNTIME_ROOT_CHANGED")
    manifest_path = absolute(source["sourceManifestFile"])
    manifest_raw, bindings["reservedRuntimeManifest"] = stable_bytes(
        manifest_path, source["sourceManifestSha256"], limit=4 * 1024 * 1024)
    manifest = parse(manifest_raw)
    files = manifest.get("files")
    need(set(manifest) == {"schema", "sourceDirectory", "runtimeDirectory", "files"} and
         manifest.get("schema") == "stellar-forge.node-successor-runtime-source.v1" and
         manifest.get("sourceDirectory") == str(source_directory) and
         manifest.get("runtimeDirectory") == str(runtime) and
         len(manifest_raw) == source["sourceManifestBytes"] and
         isinstance(files, list) and 0 < len(files) <= 10000 and len(files) == source["fileCount"] and
         all(isinstance(item, dict) and set(item) == {"path", "bytes", "sha256"} and
             isinstance(item["path"], str) and item["path"] and
             not Path(item["path"]).is_absolute() and "\0" not in item["path"] and "\\" not in item["path"] and
             all(part not in ("", ".", "..") for part in item["path"].split("/")) and
             type(item["bytes"]) is int and 0 <= item["bytes"] <= 64 * 1024 * 1024 and
             isinstance(item["sha256"], str) and SHA.fullmatch(item["sha256"]) for item in files) and
         len({item["path"] for item in files}) == len(files) and
         sum(item["bytes"] for item in files) == source["sourceBytes"] and
         hashlib.sha256(compact_json(files)).hexdigest() == source["filesSha256"],
         "ORIGINAL_RESERVED_RUNTIME_MANIFEST_CHANGED")
    # Retain the original manifest bytes in this process observation. The
    # existing runtime's workspace check verifies every selected source file
    # again before the authenticated ledger audit and original approval path.


def not_dispatched_proof(attempt, operation, bindings, directory, workspace, intent_id, config_sha):
    receipt = attempt.get("nativeStart")
    need(attempt.get("state") == "NOT_DISPATCHED" and attempt.get("pid") is None and
         not (isinstance(attempt.get("processIdentity"), dict) and
              attempt["processIdentity"].get("status") == "RECORDED"),
         "ORIGINAL_UNSTARTED_ATTEMPT_REQUIRED")
    need(isinstance(receipt, dict) and receipt.get("schema") == NATIVE_START_SCHEMA and
         receipt.get("nativeProcessStarted") is False and receipt.get("phase") == "BEFORE_SPAWN" and
         receipt.get("attemptStartedAt") == attempt.get("startedAt") and
         isinstance(receipt.get("errorCode"), str) and
         re.fullmatch(r"[A-Z0-9_]{1,120}", receipt["errorCode"]),
         "ORIGINAL_NATIVE_START_RECEIPT_REQUIRED")
    need(instant(receipt["observedAt"]) >= instant(attempt["startedAt"]),
         "ORIGINAL_NATIVE_START_RECEIPT_ORDER_DIFFERS")
    command = receipt.get("command")
    need(isinstance(command, list) and len(command) in (4, 9) and
         all(isinstance(arg, str) and "\0" not in arg and len(arg) <= 16384 for arg in command) and
         Path(command[0]).is_absolute() and Path(command[1]).is_absolute(),
         "ORIGINAL_NATIVE_START_COMMAND_REQUIRED")
    ticket = operation.get("ticketSha256")
    need(ticket is None or isinstance(ticket, str) and SHA.fullmatch(ticket),
         "ORIGINAL_NATIVE_START_TICKET_INVALID")
    expected_args = ["execute-workspace", "--dir", str(workspace), "--config",
                     bindings["config"]["path"], "--ticket-sha", ticket or "none"]
    if len(command) == 9:
        need(command[2:] == expected_args, "ORIGINAL_NATIVE_START_COMMAND_BINDINGS_DIFFER")
    # store.mjs jsonBytes uses JSON.stringify(value, null, 2) plus one newline.
    # The argv consists only of strings, so this reproduces those exact bytes.
    encoded = (json.dumps(command, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    need(isinstance(receipt.get("commandSha256"), str) and SHA.fullmatch(receipt["commandSha256"]) and
         hashlib.sha256(encoded).hexdigest() == receipt["commandSha256"],
         "ORIGINAL_NATIVE_START_COMMAND_SHA256_DIFFERS")
    if len(command) == 4:
        reserved_start_command(command, operation, bindings, expected_args)
    # A settled runtime return before any spawn event is retained atomically in
    # this same pinned attempt. A missing receipt never implies no child.
    confirm_bindings(bindings)
    result = result_base(intent_id, config_sha, bindings, directory, workspace)
    result.update(nativeRecord=None, nativeStart=receipt,
                  procfs={"attempt": {"outcome": "ORIGINAL_NATIVE_PROCESS_NOT_DISPATCHED"}})
    return result


def inspect_request(request_path):
    request_raw, request_binding = stable_bytes(absolute(request_path))
    selected = parse(request_raw)
    need(selected.get("schema") == REQUEST_SCHEMA, "PROCESS_PROOF_REQUEST_SCHEMA_REQUIRED")
    intent_id = selected.get("intentId")
    need(isinstance(intent_id, str) and 0 < len(intent_id) <= 512, "ORIGINAL_INTENT_REQUIRED")
    directory = absolute(selected["operationDirectory"])
    need(directory.name == hashlib.sha256(intent_id.encode()).hexdigest(), "ORIGINAL_OPERATION_DIRECTORY_MISMATCH")
    workspace = absolute(selected["nativeWorkspace"])
    bindings = {"proofRequest": request_binding}
    documents = {}
    attempt_directory = None
    for name in ("operation", "config", "review", "attempt"):
        path = absolute(selected[name + "Path"])
        at_root = path == directory / (name + ".json")
        in_history = (name in ("review", "attempt") and path.name == name + ".json" and
                      path.parent.parent == directory / "preapproval-history" and
                      SHA.fullmatch(path.parent.name))
        need(at_root or in_history, "ORIGINAL_OPERATION_MEMBER_REQUIRED")
        if name in ("review", "attempt"):
            need(attempt_directory is None or path.parent == attempt_directory,
                 "ORIGINAL_ATTEMPT_REVIEW_DIRECTORY_DIFFERS")
            attempt_directory = path.parent
        raw, bindings[name] = stable_bytes(path, selected["expected"][name + "Sha256"],
                                            limit=ATTEMPT_LIMIT if name == "attempt" else MAX_FILE)
        documents[name] = parse(raw)
    operation, config, review, attempt = (documents[name] for name in ("operation", "config", "review", "attempt"))
    config_sha = bindings["config"]["sha256"]
    need(operation.get("schema") == "stellar-forge.node-buyer.v1" and operation.get("state") == "PREPARED" and
         all(value.get("intentId") == intent_id for value in (operation, config.get("operation", {}), review, attempt)) and
         all(value.get("configSha256") == config_sha for value in (operation, review, attempt)),
         "ORIGINAL_OPERATION_BINDINGS_DIFFER")
    need(operation.get("nativeWorkspace") == str(workspace) == review.get("nativeWorkspace") and
         review.get("native", {}).get("mode") == "OFFLINE_REVIEW" and
         review["native"].get("intentId") == intent_id and
         all(value.get("bodySha256") == operation.get("bodySha256") for value in (review, attempt)),
         "ORIGINAL_REVIEW_BINDINGS_DIFFER")
    need(instant(operation["createdAt"]) <= instant(attempt["startedAt"]), "ORIGINAL_ATTEMPT_ORDER_DIFFERS")
    need(config.get("operator", {}).get("ledger") == str(workspace / "reservations.sqlite") and
         config["operator"].get("policy") == str(workspace / "policy.json") and
         config.get("signerModule") == str(workspace / "signer.mjs"), "ORIGINAL_NATIVE_WORKSPACE_BINDINGS_DIFFER")

    if attempt.get("state") == "NOT_DISPATCHED":
        return not_dispatched_proof(attempt, operation, bindings, directory, workspace, intent_id, config_sha)
    need(attempt.get("state") in ("STARTED", "INTERRUPTED_OR_START_FAILED", "NATIVE_RESULT_UNAVAILABLE") and
         type(attempt.get("pid")) is int and attempt["pid"] > 0, "ORIGINAL_STARTED_ATTEMPT_REQUIRED")

    if isinstance(attempt.get("processIdentity"), dict) and attempt["processIdentity"].get("status") == "RECORDED":
        return recorded_identity_proof(selected, attempt, bindings, directory, workspace, intent_id, config_sha)

    selection = selected["nativeRecord"]
    root = absolute(selection["directory"])
    host = absolute(selection["hostRoot"])
    with existing_record_lock(root) as record_lock:
        retained = {}
        for name, filename, key in (("nativeRequest", "request.json", "requestSha256"),
                                    ("nativeProcess", "process.json", "processSha256"),
                                    ("nativeOutput", "output.log", "outputSha256")):
            raw, bindings[name] = stable_bytes(root / filename, selection[key])
            retained[name] = raw
        native_request, process = parse(retained["nativeRequest"]), parse(retained["nativeProcess"])
        intent = native_request.get("intent", {})
        operation_id = selection["operationId"]
        need(native_request.get("schema") == "commons.native_cloud_command/v1" and
             intent.get("operation_id") == operation_id and
             root.name == hashlib.sha256(operation_id.encode()).hexdigest(), "ORIGINAL_NATIVE_RECORD_MISMATCH")
        command = selection["command"]
        need(isinstance(command, list) and command == intent.get("command") and
             all(isinstance(arg, str) and "\0" not in arg for arg in command), "ORIGINAL_NATIVE_COMMAND_MISMATCH")
        driver = absolute(selection["driverPath"])
        _, bindings["driver"] = stable_bytes(driver, selection["driverSha256"])
        need(command.count(str(driver)) == 1 and str(driver) in intent.get("runtime_paths", []),
             "ORIGINAL_DRIVER_DECLARATION_MISMATCH")
        disk_paths = [Path(row["path"]) for row in intent.get("disk", {}).get("paths", [])]
        need(any(contained(directory, path) and contained(workspace, path) for path in disk_paths),
             "ORIGINAL_WORKSPACE_NOT_IN_NATIVE_REQUEST")
        log = [parse(line) for line in retained["nativeOutput"].splitlines() if line.strip()]
        reviews = [i for i, line in enumerate(log) if line.get("phase") == "original-workspace-and-node-review" and
                   line.get("intentId") == intent_id and line.get("configSha256") == config_sha]
        approvals = [i for i, line in enumerate(log) if line.get("phase") == "original-native-approval-next" and
                     line.get("intentId") == intent_id]
        need(len(reviews) == len(approvals) == 1 and reviews[0] < approvals[0] == len(log) - 1,
             "ORIGINAL_NATIVE_APPROVAL_BOUNDARY_DIFFERS")
        terms = config["operation"]["expect"]
        need(log[approvals[0]].get("network") == terms["network"] and
             log[approvals[0]].get("amountAtomic") == terms["maxAtomic"] and
             log[approvals[0]].get("asset") == terms["asset"], "ORIGINAL_NATIVE_APPROVAL_TERMS_DIFFER")
        raw, bindings["nativeState"] = stable_bytes(root / "state.json")
        state = parse(raw)
        need(state.get("process") == process and isinstance(state.get("supervisor"), dict) and
             state["supervisor"].get("namespace") == process.get("namespace") and
             state["supervisor"].get("boot_id") == process.get("boot_id") and
             instant(native_request["created_at"]) <= instant(operation["createdAt"]),
             "ORIGINAL_NATIVE_PROCESS_BINDINGS_DIFFER")
        _, bindings["nativeEntry"] = stable_bytes(host / "swarm_cloud_job.py")
        _, bindings["nativeLoader"] = stable_bytes(host / "native_foreground.py")
        sys.path.insert(0, str(host))
        loader = importlib.import_module("native_foreground")
        need(Path(loader.__file__).resolve() == host / "native_foreground.py", "ORIGINAL_NATIVE_LOADER_REQUIRED")
        native = loader.load_native(host)
        # The installed inspector owns any observation locks. Release our short
        # metadata guard before calling it, then recheck every hash and inode.
        fcntl.flock(record_lock.fileno(), fcntl.LOCK_UN)
        observation = native.inspect(root, capacity=False)
        need(observation.get("operation_id") == operation_id and observation.get("state") == "interrupted" and
             observation.get("supervisor_alive") is False and observation.get("process_alive") is False,
             "ORIGINAL_NATIVE_OPERATION_NOT_INTERRUPTED")
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        parent_observation = process_absent(state["supervisor"], boot)
        process_observation = process_absent(process, boot)
        attempt_observation = legacy_pid_absent(attempt["pid"], process["namespace"], boot, process["boot_id"])
        process_absent(state["supervisor"], boot)
        process_absent(process, boot)
        confirm_bindings(bindings)
        need(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == boot, "KERNEL_BOOT_CHANGED")
    result = result_base(intent_id, config_sha, bindings, directory, workspace)
    result.update(nativeRecord={"directory": str(root), "hostRoot": str(host),
                  "operationId": operation_id, "command": command, "state": observation["state"],
                  "supervisorAlive": False, "processAlive": False,
                  "supervisor": state["supervisor"], "process": process,
                  "supervisorObservation": parent_observation, "processObservation": process_observation},
                  procfs={"bootId": boot, "attempt": attempt_observation})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_request(args.request), separators=(",", ":")))
        return 0
    except (OSError, ValueError, KeyError, TypeError, IndexError, ImportError) as error:
        code = str(error) if isinstance(error, ProofError) else "PROCESS_PROOF_" + type(error).__name__.upper()
        print(json.dumps({"schema": SCHEMA, "outcome": "PROCESS_PROOF_UNAVAILABLE", "code": code}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
