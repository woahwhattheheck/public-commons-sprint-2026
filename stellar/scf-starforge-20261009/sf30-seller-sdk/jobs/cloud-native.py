#!/usr/bin/env python3
"""Run the retained SCF paid-jobs journey inside an existing native worker.

The existing CloudJobs/native operator owns submission, process custody and
artifact transport. This foreground payload installs one complete source cut,
uses its original runtime profile, and invokes its original drivers. A completed
core capsule adopts the earlier actual result before customer/checkout continuation.
"""
from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

OPERATION = "SCF-DURABLE-PAID-JOBS-0B8D-20261011"
REPOSITORY = "https://github.com/woahwhattheheck/public-commons-sprint-2026.git"
SOURCE = Path("stellar/scf-starforge-20261009")
RETAINED = Path("/dev/shm/0b8d-scf-paid-jobs-native/sf30-paid-jobs-CKQrif")
ORIGINAL_CORE_DIRECTORY = RETAINED
CAPSULE_SCHEMA = "stellar-forge.paid-job-native-capsule.v1"
RUN_SCHEMA = "stellar-forge.paid-job-native-worker.v1"
MAX_CAPSULE = 256 * 1024 * 1024
PHASES = ("baseline", "customer", "checkout")
APPLICATIONS_OPERATION = "SCF-JOB-MANAGED-APPLICATIONS-0B8D-20261012"
child = None
interrupted = None


def require(value, code):
    if not value:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, maximum=MAX_CAPSULE):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "REGULAR_FILE_REQUIRED:" + str(path))
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require(len(data) <= maximum and
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "INPUT_CHANGED:" + str(path))
        return data


def read_json(path):
    return json.loads(regular(path, 4 * 1024 * 1024))


def private_directory(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, "REAL_ABSOLUTE_DIRECTORY_REQUIRED:" + str(path))
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077 and info.st_uid == os.getuid(),
            "PRIVATE_OWNED_DIRECTORY_REQUIRED:" + str(path))
    return path


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save_bytes(path, data):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save(path, value):
    save_bytes(path, encoded(value))


def immutable(path, data):
    path = Path(path)
    prefix = ".immutable-" + digest(path.name.encode("utf-8") + b"\0" + data) + "-"
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = None
    try:
        # Directory flock adds no file to the strict original carrier inventory.
        # It also excludes another live publisher while owned staging is recovered.
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for pending in path.parent.iterdir():
            if not pending.name.startswith(prefix):
                continue
            info = pending.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                    not info.st_mode & 0o077 and info.st_nlink in (1, 2),
                    "ORIGINAL_IMMUTABLE_STAGING_CHANGED:" + str(pending))
            prior = regular(pending, len(data))
            require(data.startswith(prior), "ORIGINAL_IMMUTABLE_STAGING_BYTES_CHANGED:" + str(pending))
            pending.unlink()
        try:
            existing = regular(path)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            require(existing == data, "RETAINED_INPUT_CHANGED:" + str(path))
            os.fsync(directory)
            return
        descriptor, temporary = tempfile.mkstemp(prefix=prefix, dir=path.parent)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            require(regular(path) == data, "RETAINED_INPUT_CHANGED:" + str(path))
        os.fsync(directory)
    finally:
        try:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
                os.fsync(directory)
        finally:
            os.close(directory)


def emit(value):
    print(json.dumps(value, sort_keys=True), flush=True)


def stop(signum, _frame):
    global interrupted
    interrupted = signum
    if child is not None and child.poll() is None:
        try:
            os.killpg(child.pid, signum)
        except ProcessLookupError:
            pass


def execute(argv, log, *, cwd, env=None, allow_failure=False, shutdown_grace=30):
    """One foreground child, with the native operator's stop forwarded to it."""
    global child
    require(interrupted is None, "NATIVE_WORKER_INTERRUPTED")
    stdout_path, stderr_path = Path(str(log) + ".stdout.log"), Path(str(log) + ".stderr.log")
    started = time.time()
    with open(stdout_path, "ab", buffering=0) as stdout, open(stderr_path, "ab", buffering=0) as stderr:
        child = subprocess.Popen([str(value) for value in argv], cwd=cwd, env=env,
                                 stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                 start_new_session=True)
        try:
            deadline = None
            while child.poll() is None:
                if interrupted is not None:
                    deadline = deadline or time.monotonic() + shutdown_grace
                    if time.monotonic() >= deadline:
                        try:
                            os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                try:
                    child.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
            code = child.returncode
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=shutdown_grace)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            child = None
    record = {"argv": [str(value) for value in argv], "exitCode": code,
              "seconds": round(time.time() - started, 3),
              "stdout": str(stdout_path), "stderr": str(stderr_path)}
    if code and not allow_failure:
        error = RuntimeError("ORIGINAL_COMMAND_FAILED:" + str(argv[0]))
        error.command = record
        raise error
    return record


def output_json(command):
    # Commands passed here are the original read-only version/profile probes.
    data = regular(command["stdout"], 4 * 1024 * 1024)
    decoder = json.JSONDecoder()
    for index in range(len(data) - 1, -1, -1):
        if data[index:index + 1] == b"{":
            try:
                value, end = decoder.raw_decode(data[index:].decode())
                if not data[index:][end:].strip():
                    return value
            except (ValueError, UnicodeDecodeError):
                pass
    raise RuntimeError("ORIGINAL_JSON_RESULT_REQUIRED:" + command["stdout"])


def unpack_capsule(archive, expected, workspace):
    raw = regular(archive)
    require(digest(raw) == expected, "INPUT_CAPSULE_SHA256_MISMATCH")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        entries = tar.getmembers()
        require(len(entries) <= 50000 and all(entry.isfile() for entry in entries), "CAPSULE_REGULAR_ENTRIES_REQUIRED")
        names = [entry.name for entry in entries]
        require(len(names) == len(set(names)) and names.count("capsule.json") == 1, "CAPSULE_DUPLICATE_PATH")
        manifest_entry = tar.getmember("capsule.json")
        require(manifest_entry.size <= 4 * 1024 * 1024, "CAPSULE_MANIFEST_LIMIT")
        manifest = json.load(tar.extractfile(manifest_entry))
        require(manifest["schema"] == CAPSULE_SCHEMA and manifest["operation"] == OPERATION and
                manifest["retainedDirectory"] == str(RETAINED), "ORIGINAL_CAPSULE_IDENTITY_REQUIRED")
        files = manifest["files"]
        require(isinstance(files, list) and len(files) <= 49999 and
                sum(item["bytes"] for item in files) <= MAX_CAPSULE, "CAPSULE_SIZE_LIMIT")
        expected_names = {"capsule.json"}
        for item in files:
            path = PurePosixPath(item["path"])
            require(not path.is_absolute() and path.as_posix() == item["path"] and
                    path.parts and all(part not in (".", "..") for part in path.parts) and
                    type(item["bytes"]) is int and item["bytes"] >= 0 and
                    re.fullmatch(r"[a-f0-9]{64}", item["sha256"]), "CAPSULE_FILE_DESCRIPTOR_INVALID")
            expected_names.add("retained/" + item["path"])
        require(set(names) == expected_names and len(expected_names) == len(files) + 1, "CAPSULE_FILES_DIFFER")
        binding = {"archiveSha256": expected, "manifest": manifest}
        restored = workspace / "input-capsule.json"
        if restored.exists():
            require(read_json(restored) == binding, "ORIGINAL_INPUT_CAPSULE_CHANGED")
            require(RETAINED.is_dir() and RETAINED.resolve() == RETAINED, "RESTORE_ORIGINAL_RETAINED_DIRECTORY")
            return manifest
        private_directory(RETAINED.parent)
        temporary = None if RETAINED.exists() else Path(tempfile.mkdtemp(prefix=".retained-", dir=RETAINED.parent))
        target = temporary or RETAINED
        try:
            private_directory(target)
            actual_names = set()
            for item in files:
                entry = tar.getmember("retained/" + item["path"])
                require(entry.size == item["bytes"], "CAPSULE_MEMBER_SIZE_MISMATCH")
                data = tar.extractfile(entry).read(item["bytes"] + 1)
                require(len(data) == item["bytes"] and digest(data) == item["sha256"], "CAPSULE_MEMBER_HASH_MISMATCH")
                destination = target / item["path"]
                private_directory(destination.parent)
                immutable(destination, data)
                actual_names.add(item["path"])
            require({path.relative_to(target).as_posix() for path in target.rglob("*") if path.is_file()} ==
                    actual_names, "EXISTING_RETAINED_DIRECTORY_DIFFERS")
            sync_directory(target)
            if temporary:
                os.rename(temporary, RETAINED)
                sync_directory(RETAINED.parent)
                temporary = None
            immutable(restored, encoded(binding))
        finally:
            if temporary and temporary.exists():
                shutil.rmtree(temporary)
    return manifest


def completed_capsule_header(archive, expected):
    """Read the exact transferred identity before selecting the existing source helper."""
    raw = regular(archive)
    require(digest(raw) == expected, "COMPLETED_INPUT_CAPSULE_SHA256_MISMATCH")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        entries = tar.getmembers()
        require(len(entries) <= 50000 and all(entry.isfile() for entry in entries),
                "COMPLETED_INPUT_REGULAR_MEMBERS_REQUIRED")
        names = [entry.name for entry in entries]
        require(len(names) == len(set(names)) and names.count("capsule.json") == 1,
                "COMPLETED_INPUT_MANIFEST_REQUIRED")
        member = tar.getmember("capsule.json")
        require(member.size <= 4 * 1024 * 1024, "COMPLETED_INPUT_MANIFEST_LIMIT")
        manifest = json.load(tar.extractfile(member))
    require(manifest.get("schema") == "stellar-forge.paid-job-native-completed-core.v1" and
            manifest.get("operation") == OPERATION, "COMPLETED_INPUT_OPERATION_CHANGED")
    retained = Path(manifest["retainedDirectory"])
    require(retained.is_absolute() and retained.resolve() == retained and
            retained.name == "sf30-paid-jobs-CKQrif", "COMPLETED_ORIGINAL_DIRECTORY_REQUIRED")
    return manifest


def completed_capsule_tools(source):
    path = source / SOURCE / "sf30-seller-sdk/jobs/native_capsule.py"
    require(path.is_file() and not path.is_symlink(), "ORIGINAL_COMPLETED_CAPSULE_SOURCE_REQUIRED")
    spec = importlib.util.spec_from_file_location("scf_paid_jobs_original_capsule", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_checkout(workspace, commit, logs):
    source = workspace / "source"
    if not source.exists():
        private_directory(source)
        execute(["git", "init", "--quiet", source], logs / "git-init", cwd=workspace)
        execute(["git", "-C", source, "remote", "add", "origin", REPOSITORY], logs / "git-origin", cwd=workspace)
    require((source / ".git").is_dir() and source.resolve() == source, "ORIGINAL_PRIVATE_CHECKOUT_REQUIRED")
    origin = subprocess.check_output(["git", "-C", source, "remote", "get-url", "origin"], text=True).strip()
    require(origin == REPOSITORY, "ORIGINAL_SOURCE_REMOTE_CHANGED")
    dirty = subprocess.check_output(["git", "-C", source, "status", "--porcelain", "--untracked-files=no"], text=True)
    require(not dirty, "PRESERVE_CHANGED_ORIGINAL_SOURCE")
    current = subprocess.run(["git", "-C", source, "rev-parse", "--verify", "HEAD"],
                             capture_output=True, text=True)
    head = current.stdout.strip() if current.returncode == 0 else None
    if head != commit:
        execute(["git", "-C", source, "fetch", "--depth=1", "--no-tags", "origin", commit],
                logs / "git-fetch", cwd=workspace)
        execute(["git", "-C", source, "checkout", "--quiet", "--detach", commit],
                logs / "git-checkout", cwd=workspace)
    require(subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip() == commit,
            "ORIGINAL_SOURCE_COMMIT_MISMATCH")
    # A full checkout retains dynamic Python and Node imports, schemas, assets,
    # component manifests, and operator engines; no handwritten import subset.
    required = [SOURCE / "sf30-seller-sdk/jobs/native-journey.mjs",
                SOURCE / "sf88-operator-buyer-cli/job-workspace/continuation.mjs",
                SOURCE / "sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py",
                SOURCE / "sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.mjs",
                SOURCE / "sf88-operator-buyer-cli/node/client.mjs",
                SOURCE / "sf62-human-approval-cli/console.py",
                SOURCE / "sf36-spend-governor/governor.py",
                Path("stellar-forge/payment-auto-catalog/package.json"),
                SOURCE / "sf30-seller-sdk/jobs/agent/native-continuation.mjs",
                SOURCE / "sf30-seller-sdk/jobs/managed/receiving.mjs",
                SOURCE / "distribution/build.mjs",
                SOURCE / "distribution/runtime-install-cli.mjs",
                SOURCE / "distribution/runtime-workspace/cli.mjs"]
    capsule_source = SOURCE / 'sf30-seller-sdk/jobs/native_capsule.py'
    if (source / capsule_source).is_file():
        required.append(capsule_source)
    hashes = {path.as_posix(): digest(regular(source / path)) for path in required}
    return source, hashes


def install_runtime(source, workspace, node, npm, python, logs, offline):
    profile_cli = source / SOURCE / "distribution/runtime-profile-cli.mjs"
    selection = ["--source-root", source, "--native", "--feature", "schema", "--operator",
                 "--pin", "@stellar/stellar-sdk@16.3.1"]
    resolved = output_json(execute([node, profile_cli, "resolve", *selection],
                                   logs / "runtime-resolve", cwd=workspace))
    require(re.fullmatch(r"[a-f0-9]{64}", resolved.get("profileId", "")), "ORIGINAL_RUNTIME_PROFILE_REQUIRED")
    runtimes = private_directory(workspace / "runtimes")
    runtime = runtimes / resolved["profileId"]
    execute([node, profile_cli, "create", "--directory", runtime, *selection],
            logs / "runtime-profile", cwd=workspace)
    dependencies = runtime / "node_modules"
    link = source / "node_modules"
    if link.is_symlink():
        old = link.resolve()
        require(old.is_relative_to(runtimes) and old.name == "node_modules",
                "ORIGINAL_SOURCE_DEPENDENCY_LINK_CHANGED")
        if old != dependencies.resolve():
            pending = source / (".node-modules-" + resolved["profileId"])
            if pending.is_symlink():
                require(pending.resolve() == dependencies.resolve(), "PENDING_DEPENDENCY_LINK_CHANGED")
            else:
                require(not pending.exists(), "PRESERVE_PENDING_SOURCE_FILE")
                pending.symlink_to(dependencies, target_is_directory=True)
            os.replace(pending, link)
    else:
        require(not link.exists(), "PRESERVE_EXISTING_SOURCE_DEPENDENCIES")
        link.symlink_to(dependencies, target_is_directory=True)
    inspect = [node, profile_cli, "inspect", "--profile", runtime / "profile.json",
               "--directory", runtime, "--source-root", source, "--load", "--python", python]
    observed = execute(inspect, logs / "runtime-inspect-before", cwd=workspace, allow_failure=True)
    if observed["exitCode"]:
        cache = private_directory(workspace / "npm-cache")
        mode = "ci" if (runtime / "package-lock.json").is_file() else "install"
        args = [npm, mode, "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache]
        if offline:
            args.append("--offline")
        execute(args, logs / "runtime-install", cwd=runtime)
        observed = execute(inspect, logs / "runtime-inspect", cwd=workspace)
    report = output_json(observed)
    require(report.get("ready") is True, "ORIGINAL_RUNTIME_NOT_READY")
    retained = private_directory(logs.parent / "runtime" / report["profileId"])
    for name in ("profile.json", "package.json", "package-lock.json"):
        immutable(retained / name, regular(runtime / name))
    save(retained / "inspection.json", report)
    return {"directory": str(runtime), "profileId": report["profileId"],
            "profileSha256": digest(regular(runtime / "profile.json")),
            "lockSha256": digest(regular(runtime / "package-lock.json")), "inspection": report}


def completed(path, phase, approval="terminal", input_files=False, source_commit=None):
    if not path.is_file():
        return None
    value = read_json(path)
    expected_directory = ORIGINAL_CORE_DIRECTORY if phase == "baseline" else RETAINED
    require(value.get("result") == "PASS" and value.get("retainedWorkDirectory") == str(expected_directory),
            "ORIGINAL_PHASE_RESULT_CHANGED:" + phase)
    if phase == "baseline":
        require(value.get("nativeSettlements") == 2 and
                {job["jobId"] for job in value.get("jobs", [])} == {"report:2026.10", "recovery:2026.10"},
                "ORIGINAL_BASELINE_RESULT_REQUIRED")
    elif phase == "customer":
        require(value.get("operation") == "SCF-JOB-CUSTOMER-WORKSPACE-0B8D-20261011" and
                value.get("originalSettlementEvents") == 2, "ORIGINAL_CUSTOMER_RESULT_REQUIRED")
    elif phase == "applications":
        received = value.get("receiving", {})
        require(value.get("schema") == "stellar-forge.job-applications-native-result.v1" and
                value.get("operation") == APPLICATIONS_OPERATION and value.get("sourceCommit") == source_commit and
                received.get("schema") == "stellar-forge.job-merchant-applications-received.v1" and
                received.get("state") == "COMPLETE" and len(received.get("starts", [])) == 2 and
                {job.get("id") for job in received.get("completedJobs", [])} == {"input-files:2026.10"},
                "ORIGINAL_INSTALLED_APPLICATIONS_RESULT_REQUIRED")
        require(len({item["launch"]["instanceId"] for item in received["starts"]}) == 2 and
                all(item["exit"]["state"] == "STOPPED" and item["exit"]["closeErrors"] == []
                    for item in received["starts"]), "ORIGINAL_APPLICATIONS_DRAIN_REQUIRED")
    else:
        operation = "SCF-JOB-INPUT-FILES-0B8D-20261012" if input_files else (
            "SCF-JOB-BROWSER-APPROVAL-0B8D-20261012" if approval == "browser" else
            "SCF-JOB-CHECKOUT-CONTINUATION-0B8D-20261012")
        require(value.get("operation") == operation and
                value.get("operatorLedger", {}).get("reservations") == 1, "ORIGINAL_CHECKOUT_RESULT_REQUIRED")
        if approval == "browser":
            intake = value.get("selfService", {})
            expected_job = "input-files:2026.10" if input_files else "browser-checkout:2026.10"
            require(intake.get("reference") == expected_job and
                    intake.get("phase") == "IMPORTED" and intake.get("reopened") is True and
                    value.get("approvalMode") == "ORIGINAL_BROWSER_BROKER",
                    "ORIGINAL_BROWSER_INTAKE_RESULT_REQUIRED")
        if input_files:
            files, resolution, agent = value.get("inputFiles", {}), value.get("resolution", {}), value.get("agent", {})
            require(files.get("operation") == operation and files.get("records") == 6000 and
                    files.get("merchantFiles") == 2 and files.get("lostChunkAck", {}).get("status") == 200 and
                    files.get("localRestart", {}).get("resumedChunks", 0) >= 1 and
                    files.get("merchantRestart", {}).get("receivedChunks", 0) >= 1,
                    "ORIGINAL_COMPLETE_INPUT_RECEIVING_REQUIRED")
            require(resolution.get("schema") == "stellar-forge.job-resolution-native-result.v1" and
                    resolution.get("result") == "PASS" and resolution.get("jobId") == expected_job and
                    resolution.get("entryId") == value["checkout"]["jobEntryId"] and
                    resolution.get("caseState") == "CLOSED" and
                    resolution.get("adjustment", {}).get("kind") == "CANCELLATION" and
                    resolution.get("adjustment", {}).get("status") == "RECORDED",
                    "ORIGINAL_COMPLETE_RESOLUTION_REQUIRED")
            require(agent.get("schema") == "stellar-forge.paid-job-agent-native-result.v1" and
                    agent.get("result") == "PASS" and agent.get("jobId") == expected_job and
                    agent.get("accountingRunId") == resolution.get("accountingRunId") and
                    re.fullmatch(r"[a-f0-9]{64}", agent.get("manifestSha256", "")),
                    "ORIGINAL_COMPLETE_AGENT_RECEIVING_REQUIRED")
    return value


def applications_receiving(source, workspace, out, node, args, env, state, state_path):
    """Build, install and receive through the maintained installed product commands."""
    stage = private_directory(out / "applications")
    plan_path = stage / "continuation.json"
    checkout_path = out / "checkout.json"
    checkout = completed(checkout_path, "checkout", args.approval, args.input_files, args.source_commit)
    fixture = Path(checkout["fixtureDirectory"])
    require(fixture == RETAINED / "checkout-input-files-continuation" and fixture.resolve() == fixture,
            "ORIGINAL_INPUT_MERCHANT_REQUIRED")
    identity = {"sourceCommit": args.source_commit, "checkoutSha256": digest(regular(checkout_path)),
                "validationOperation": args.validation_operation, "retainedDirectory": str(RETAINED)}
    plan = read_json(plan_path) if plan_path.exists() else {
        "schema": "stellar-forge.job-applications-native-continuation.v1", "identity": identity,
        "runtimeDirectory": str(workspace / "applications-runtime"),
        "runtimeWorkspace": str(stage / "workspace"), "runtimeId": None, "recoveries": [],
    }
    require(plan.get("identity") == identity, "ORIGINAL_APPLICATIONS_INPUT_CHANGED")
    save(plan_path, plan)
    steps = state["phases"]["applications"].setdefault("steps", {})

    def step(name, argv, *, allow_failure=False, shutdown_grace=30):
        attempt = {"status": "RUNNING", "argv": [str(v) for v in argv],
                   "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        steps.setdefault(name, []).append(attempt)
        save(state_path, state)
        command = execute(argv, out / "logs" / ("applications-" + name), cwd=source, env=env,
                          allow_failure=True, shutdown_grace=shutdown_grace)
        attempt.update(command)
        attempt["status"] = "COMPLETED" if command["exitCode"] == 0 else "FAILED"
        save(state_path, state)
        if command["exitCode"] and not allow_failure:
            error = RuntimeError("ORIGINAL_APPLICATIONS_COMMAND_FAILED:" + name)
            error.command = command
            raise error
        return command

    release_directory = workspace / "merchant-release"
    build_argv = [node, source / SOURCE / "distribution/build.mjs", "--repo", source,
                  "--ref", args.source_commit, "--out", release_directory, "--python", sys.executable]
    if release_directory.exists():
        build_argv.append("--resume")
    if args.offline:
        build_argv.append("--offline")
    release = output_json(step("build", build_argv))
    require(release.get("status") == "PACKAGED" and release.get("sourceCommit") == args.source_commit and
            re.fullmatch(r"[a-f0-9]{64}", release.get("sha256", "")), "ORIGINAL_RELEASE_REQUIRED")
    archive = Path(release["archive"])
    require(archive.is_absolute() and archive.is_relative_to(release_directory) and
            digest(regular(archive, 64 * 1024 * 1024)) == release["sha256"], "ORIGINAL_RELEASE_ARCHIVE_CHANGED")
    save(stage / "distribution.json", release)
    immutable(stage / "source.tgz", regular(archive, 64 * 1024 * 1024))
    pins_path = stage / "pins.json"
    immutable(pins_path, encoded({"@stellar/stellar-sdk": "16.3.1"}))
    installer = [node, source / SOURCE / "distribution/runtime-install-cli.mjs"]
    install_options = ["--cache", private_directory(workspace / "npm-cache")]
    if args.offline:
        install_options.append("--offline")

    def runtime_files(runtime):
        target = private_directory(stage / "runtime-files")
        for name in ("preparation.json", "runtime-install.json", "runtime-profile.json", "install-state.json",
                     "package.json", "package-lock.json", "prepare-error.json", "RUNBOOK.md"):
            path = runtime / name
            if path.is_file() and not path.is_symlink():
                save_bytes(target / name, regular(path, 16 * 1024 * 1024))
        for path in sorted(runtime.glob("install-*.log")):
            if path.is_file() and not path.is_symlink():
                save_bytes(target / path.name, regular(path, 64 * 1024 * 1024))

    runtime = Path(plan["runtimeDirectory"])
    try:
        # The original installer owns in-place installation and fresh-directory
        # recovery of an interrupted preparation, including a truncated plan.
        retained_install = None
        if runtime.exists():
            try:
                candidate = read_json(runtime / "runtime-install.json")
                if isinstance(candidate, dict) and candidate.get("schema") == "stellar-forge.runtime-install.v1" and \
                        isinstance(candidate.get("source"), dict) and candidate.get("sourceRoot") and \
                        candidate.get("installationId") and candidate.get("profileId"):
                    retained_install = candidate
            except (FileNotFoundError, ValueError):
                pass
        if runtime.exists() and retained_install is None:
            pending = read_json(runtime / "preparation.json") if (runtime / "preparation.json").is_file() else None
            require(pending is not None and pending.get("archiveSha256") == release["sha256"],
                    "ORIGINAL_RUNTIME_PREPARATION_REQUIRED")
            successor = workspace / ("applications-runtime-recovery-" + str(len(plan["recoveries"]) + 1))
            plan["recoveries"].append({"from": str(runtime), "directory": str(successor),
                                       "archiveSha256": release["sha256"]})
            plan["runtimeDirectory"] = str(successor)
            save(plan_path, plan)
            runtime = successor
            step("recover", [*installer, "recover", "--from", plan["recoveries"][-1]["from"],
                             "--dir", runtime, *install_options])
        elif not runtime.exists():
            step("prepare", [*installer, "prepare", "--dir", runtime, "--archive", archive,
                             "--sha256", release["sha256"], "--native", "--feature", "schema",
                             "--operator", "--pins", pins_path])
        original_plan = read_json(runtime / "runtime-install.json")
        require(original_plan.get("archiveSha256") == release["sha256"] and
                original_plan.get("source", {}).get("sourceCommit") == args.source_commit,
                "ORIGINAL_INSTALLED_SOURCE_CHANGED")
        step("install", [*installer, "install", "--dir", runtime, *install_options])
        inspection = output_json(step("inspect", [*installer, "inspect", "--dir", runtime, "--load", "--source"]))
        require(inspection.get("ready") is True and inspection.get("status") == "READY" and
                inspection.get("sourceVerified") is True and inspection.get("sourceCommit") == args.source_commit,
                "ORIGINAL_INSTALLED_RUNTIME_NOT_READY")
        save(stage / "runtime-inspection.json", inspection)

        def installed(command):
            return [*installer, "run", "--dir", runtime, "--", *command]

        runtime_workspace = Path(plan["runtimeWorkspace"])
        if not (runtime_workspace / "workspace.json").is_file():
            if runtime_workspace.exists():
                # No Applications command can open a workspace before this
                # original config exists. Preserve an interrupted initialization.
                plan.setdefault("workspaceInitializations", []).append(str(runtime_workspace))
                runtime_workspace = stage / ("workspace-" + str(len(plan["workspaceInitializations"])))
                plan["runtimeWorkspace"] = str(runtime_workspace)
                save(plan_path, plan)
            step("workspace-init", installed(["runtime-workspace", "init", "--workspace", runtime_workspace]))
        attached = output_json(step("workspace-attach", installed([
            "runtime-workspace", "attach", "--workspace", runtime_workspace,
            "--runtime", runtime, "--label", "Complete paid-job merchant release"])))
        require(re.fullmatch(r"[a-f0-9]{24}", attached.get("runtimeId", "")) and attached.get("status") == "READY",
                "ORIGINAL_APPLICATIONS_RUNTIME_ID_REQUIRED")
        require(plan["runtimeId"] in (None, attached["runtimeId"]), "ORIGINAL_APPLICATIONS_RUNTIME_CHANGED")
        plan["runtimeId"] = attached["runtimeId"]
        save(plan_path, plan)
        record_directory = stage / "receiving"
        receiving_input = {
            "schema": "stellar-forge.job-merchant-applications-receiving.v1",
            "runtimeWorkspace": str(runtime_workspace), "runtimeId": plan["runtimeId"],
            "settings": {"stateDirectory": str(fixture / "merchant-state"),
                         "configurationFile": str(fixture / "merchant.json"),
                         "sellerPort": 0, "customerPort": 0, "port": 0, "operationsPort": 0,
                         "startWorker": False, "startDelivery": False, "landing": "jobs"},
            "jobIds": [checkout["resolution"]["jobId"]], "recordDirectory": str(record_directory),
            "label": "Original completed invoice reconciliation", "timeoutMs": 600000,
        }
        input_path = stage / "receiving-input.json"
        immutable(input_path, encoded(receiving_input))
        step("receiving", installed(["jobs-merchant-receive", "--input", input_path]), shutdown_grace=90)
        received = read_json(record_directory / "result.json")
        require(received.get("schema") == "stellar-forge.job-merchant-applications-received.v1" and
                received.get("state") == "COMPLETE" and received.get("runtimeId") == plan["runtimeId"] and
                received.get("runtimeWorkspace") == str(runtime_workspace) and
                received.get("merchant", {}).get("directory") == str(fixture / "merchant-state") and
                {job.get("id") for job in received.get("completedJobs", [])} == set(receiving_input["jobIds"]),
                "ORIGINAL_APPLICATIONS_RECEIVING_CHANGED")
        result = {"schema": "stellar-forge.job-applications-native-result.v1", "operation": APPLICATIONS_OPERATION,
                  "result": "PASS", "retainedWorkDirectory": str(RETAINED), "sourceCommit": args.source_commit,
                  "validationOperation": args.validation_operation, "release": release,
                  "runtime": {"directory": str(runtime), "runtimeId": plan["runtimeId"],
                              "sourceRoot": inspection["sourceRoot"], "profileId": inspection["profileId"],
                              "lockSha256": digest(regular(runtime / "package-lock.json", 16 * 1024 * 1024))},
                  "receiving": received, "receivingSha256": digest(regular(record_directory / "result.json"))}
        save(out / "applications.json", result)
        plan["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save(plan_path, plan)
        return result
    finally:
        if runtime.is_dir():
            runtime_files(runtime)


def capture_retained(path):
    require(RETAINED.is_dir(), "ORIGINAL_RETAINED_DIRECTORY_REQUIRED")
    descriptor = os.open(RETAINED / "merchant-state/lease.lock", os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    temporary = Path(str(path) + ".pending")
    files = []
    try:
        with open(temporary, "wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as tar:
                    for entry in sorted(RETAINED.rglob("*")):
                        if entry.is_dir():
                            require(not entry.is_symlink(), "RETAINED_DIRECTORY_LINK_UNSUPPORTED")
                            continue
                        data = regular(entry)
                        name = entry.relative_to(RETAINED).as_posix()
                        files.append({"path": name, "bytes": len(data), "sha256": digest(data)})
                        require(sum(item["bytes"] for item in files) <= MAX_CAPSULE, "RETAINED_RETURN_LIMIT")
                        member = tarfile.TarInfo("retained/" + name)
                        member.mode, member.size, member.mtime = 0o600, len(data), 0
                        tar.addfile(member, io.BytesIO(data))
                    manifest = encoded({"schema": CAPSULE_SCHEMA, "operation": OPERATION,
                                        "retainedDirectory": str(RETAINED), "files": files})
                    member = tarfile.TarInfo("capsule.json")
                    member.mode, member.size, member.mtime = 0o600, len(manifest), 0
                    tar.addfile(member, io.BytesIO(manifest))
            raw.flush()
            os.fsync(raw.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
        return {"path": str(path), "bytes": path.stat().st_size,
                "sha256": digest(regular(path)), "files": len(files), "scope": "PRIVATE_ORIGINAL_OPERATION_STATE"}
    finally:
        os.close(descriptor)
        if temporary.exists():
            temporary.unlink()



def package_outputs(out):
    """One explicit native artifact for the existing worker's result transport."""
    destination = out / "native-return.tar.gz"
    temporary = out / ".native-return.pending"
    entries = [path for path in sorted(out.rglob("*")) if path.is_file() and not path.is_symlink()
               and path not in (destination, temporary)]
    try:
        with open(temporary, "wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as tar:
                    for path in entries:
                        data = regular(path)
                        entry = tarfile.TarInfo(path.relative_to(out).as_posix())
                        entry.mode, entry.size, entry.mtime = 0o600, len(data), 0
                        tar.addfile(entry, io.BytesIO(data))
            raw.flush()
            os.fsync(raw.fileno())
        os.replace(temporary, destination)
        sync_directory(out)
        return {"path": str(destination), "bytes": destination.stat().st_size,
                "sha256": digest(regular(destination)), "scope": "PRIVATE_NATIVE_RESULT"}
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    global RETAINED, ORIGINAL_CORE_DIRECTORY
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--capsule", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--input-mode", choices=("prepared", "completed-core"), default="prepared")
    parser.add_argument("--retained-directory", type=Path,
                        help="Receive completed bytes at this private project path through the original source-binding API.")
    parser.add_argument("--approval", choices=("terminal", "browser"), default="terminal")
    parser.add_argument("--input-files", action="store_true", help="Run original input files, resolution and agent receiving.")
    parser.add_argument("--applications", action="store_true", help="Build and receive that merchant through the installed Applications product.")
    parser.add_argument("--validation-operation", help="Original native controller operation for this selected release run.")
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--node-version", default="24.19.0", help="Exact selected Node 24 runtime; retained with this validation.")
    parser.add_argument("--npm", default=shutil.which("npm"))
    parser.add_argument("--offline", action="store_true", help="Use the worker's existing npm cache.")
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_commit) and
            re.fullmatch(r"[0-9a-f]{64}", args.sha256), "IMMUTABLE_SOURCE_AND_INPUT_HASH_REQUIRED")
    require(sys.version_info >= (3, 11) and sys.platform == "linux", "ORIGINAL_LINUX_PYTHON_311_REQUIRED")
    require(re.fullmatch(r"24\.[0-9]+\.[0-9]+", args.node_version) and
            tuple(map(int, args.node_version.split("."))) >= (24, 19, 0), "SELECT_SUPPORTED_NODE_24_RUNTIME")
    require(not args.input_files or args.approval == "browser", "INPUT_FILES_REQUIRE_ORIGINAL_BROWSER_APPROVAL")
    require(not args.applications or args.input_files, "APPLICATIONS_FOLLOWS_COMPLETE_INPUT_MERCHANT")
    if args.validation_operation is not None:
        require(re.fullmatch(r"[A-Z0-9][A-Z0-9._:-]{0,127}", args.validation_operation), "VALIDATION_OPERATION_INVALID")
    require(not (args.input_files or args.applications) or args.validation_operation,
            "SELECT_NATIVE_VALIDATION_OPERATION")
    require(args.retained_directory is None or args.input_mode == "completed-core",
            "PHYSICAL_PLACEMENT_REQUIRES_COMPLETED_CORE")
    input_header = None
    if args.input_mode == "completed-core":
        input_header = completed_capsule_header(args.capsule, args.sha256)
        RETAINED = Path(input_header["retainedDirectory"])
        ORIGINAL_CORE_DIRECTORY = Path(input_header["coreResult"].get("retainedDirectory", str(RETAINED)))
        require(ORIGINAL_CORE_DIRECTORY.is_absolute() and
                ORIGINAL_CORE_DIRECTORY.resolve() == ORIGINAL_CORE_DIRECTORY,
                "ORIGINAL_CORE_DIRECTORY_CHANGED")
    workspace, out = private_directory(args.workspace), private_directory(args.out)
    require(out != workspace and out.is_relative_to(workspace), "OUTPUTS_BELONG_IN_NATIVE_PROJECT")
    placement = None
    if args.retained_directory is not None and args.retained_directory != RETAINED:
        target = args.retained_directory
        require(target.is_absolute() and target.resolve() == target and
                target != workspace and target.is_relative_to(workspace) and target.name == RETAINED.name and
                not target.is_relative_to(RETAINED) and not RETAINED.is_relative_to(target),
                "PRIVATE_COMPLETED_PLACEMENT_INSIDE_PROJECT_REQUIRED")
        # Installation, mutable result output and completed input each retain
        # their own physical tree inside this same selected native project.
        reserved = [out, *(workspace / name for name in
                    ("source", "runtimes", "npm-cache", "applications-runtime", "merchant-release"))]
        require(all(target != other and not target.is_relative_to(other) and
                    not other.is_relative_to(target) for other in reserved),
                "COMPLETED_PLACEMENT_OVERLAPS_NATIVE_OUTPUT")
        placement = {"originalRetainedDirectory": str(RETAINED),
                     "originalCoreDirectory": str(ORIGINAL_CORE_DIRECTORY),
                     "retainedDirectory": str(target)}
        RETAINED = target
    logs = private_directory(out / "logs")
    lock = os.open(workspace / "payload.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state_path = out / "run-result.json"
    state = {"schema": RUN_SCHEMA, "operation": OPERATION, "sourceCommit": args.source_commit,
             "workspace": str(workspace), "outputDirectory": str(out), "retainedDirectory": str(RETAINED),
             "inputCapsuleSha256": args.sha256, "inputMode": args.input_mode,
             "approvalMode": args.approval, "inputFiles": args.input_files, "applications": args.applications,
             "validationOperation": args.validation_operation, "nodeVersion": args.node_version,
             "phases": {}, "status": "RUNNING"}
    if placement is not None:
        state["storagePlacement"] = placement
    previous = read_json(state_path) if state_path.exists() else None
    if previous:
        require(previous.get("inputMode", "prepared") == args.input_mode and
                previous.get("approvalMode", "terminal") == args.approval and
                previous.get("inputFiles", False) == args.input_files and
                previous.get("applications", False) == args.applications and
                previous.get("validationOperation") == args.validation_operation and
                previous.get("nodeVersion", "24.19.0") == args.node_version and
                previous.get("storagePlacement") == state.get("storagePlacement"),
                "ORIGINAL_NATIVE_CONTINUATION_MODE_CHANGED")
        require(all(previous.get(key) == state[key] for key in
                    ("schema", "operation", "workspace", "outputDirectory", "retainedDirectory", "inputCapsuleSha256")),
                "ORIGINAL_NATIVE_OPERATION_CHANGED")
        require(not args.validation_operation or previous["sourceCommit"] == args.source_commit,
                "SELECTED_VALIDATION_SOURCE_CHANGED")
        state["priorSourceCommits"] = list(dict.fromkeys(previous.get("priorSourceCommits", []) +
                                                       [previous["sourceCommit"]]))
        state["phases"] = previous["phases"]
    for name in ("SIGINT", "SIGTERM"):
        signal.signal(getattr(signal, name), stop)
    save(state_path, state)
    restored = False
    placement_adopted = placement is None
    completed_tools = None
    try:
        require(args.node and args.npm, "WORKER_NODE_AND_NPM_REQUIRED")
        node = str(Path(args.node).resolve())
        npm = str(Path(args.npm).resolve())
        version = subprocess.check_output([node, "--version"], text=True).strip()
        require(version == "v" + args.node_version, "WORKER_SELECTED_NODE_VERSION_MISMATCH:" + version)
        os.environ["PATH"] = str(Path(node).parent) + os.pathsep + os.environ.get("PATH", "")
        os.environ["NODE_OPTIONS"] = "--max-old-space-size=256"
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        for command in ("git", "flock", "openssl"):
            require(shutil.which(command), "WORKER_COMPONENT_REQUIRED:" + command)
        state["runtime"] = {"node": version, "python": sys.version.split()[0], "platform": sys.platform}
        if args.input_mode == "completed-core":
            source, hashes = source_checkout(workspace, args.source_commit, logs)
            completed_tools = completed_capsule_tools(source)
            capsule = completed_tools.read_completed_capsule(args.capsule, args.sha256)
            require(capsule["manifest"] == input_header, "COMPLETED_INPUT_HEADER_CHANGED")
            state["input"] = completed_tools.restore_completed_capsule(
                capsule, workspace, retained_directory=RETAINED if placement is not None else None)
            restored = True
            if placement is not None:
                placement_output = private_directory(out / "native-placement")
                immutable(placement_output / "profile.json", regular(workspace / "input-placement.json"))
                immutable(placement_output / "input-capsule.tar.gz", regular(args.capsule))
                immutable(placement_output / "original-manifest.json", encoded(capsule["manifest"]))
            # Copy the exact earlier native result, preserving its actual paths,
            # hashes, source identity and completed payment count.
            immutable(out / "baseline.json", capsule["coreResultBytes"])
            require(completed(out / "baseline.json", "baseline") is not None,
                    "ORIGINAL_COMPLETED_BASELINE_REQUIRED")
            state["phases"]["baseline"] = {
                **state["phases"].get("baseline", {}), "status": "COMPLETED", "adopted": True,
                "reused": True, "resultSha256": digest(capsule["coreResultBytes"]),
                "originalCore": state["input"]["coreResult"], "executedOnThisWorker": False,
            }
            state["completedCore"] = {"retainedDirectory": str(RETAINED),
                                      "originalCoreDirectory": str(ORIGINAL_CORE_DIRECTORY),
                                      "application": state["input"]["application"],
                                      "originalCore": state["input"]["coreResult"],
                                      "jobs": state["input"]["jobs"]}
            save(state_path, state)
            emit({"operation": OPERATION, "phase": "baseline", "status": "ADOPTED_COMPLETED",
                  "resultSha256": digest(capsule["coreResultBytes"])})
            del capsule
        else:
            state["input"] = unpack_capsule(args.capsule, args.sha256, workspace)
            restored = True
            source, hashes = source_checkout(workspace, args.source_commit, logs)
        state["sourceFiles"] = hashes
        state["installation"] = install_runtime(source, workspace, node, npm, sys.executable, logs, args.offline)
        if placement is not None:
            adapter = source / SOURCE / "sf30-seller-sdk/jobs/native-placement.mjs"
            require(adapter.is_file() and not adapter.is_symlink(), "ORIGINAL_NATIVE_PLACEMENT_ADAPTER_REQUIRED")
            state["sourceFiles"][str(adapter.relative_to(source))] = digest(regular(adapter))
            placement_output = out / "native-placement"
            command = execute([node, adapter, "--profile", workspace / "input-placement.json",
                               "--review", placement_output / "review.json",
                               "--out", placement_output / "adoption.json"],
                              logs / "native-placement", cwd=source)
            adoption = output_json(command)
            require(adoption.get("schema") == "stellar-forge.paid-job-native-placement-result.v1" and
                    adoption.get("operation") == OPERATION and
                    adoption.get("retainedDirectory") == str(RETAINED) and
                    adoption.get("originalCoreDirectory") == str(ORIGINAL_CORE_DIRECTORY) and
                    adoption.get("adoption", {}).get("source") == state["input"]["source"],
                    "ORIGINAL_NATIVE_PLACEMENT_ADOPTION_REQUIRED")
            placement_adopted = True
            state["storageAdoption"] = adoption
            save(state_path, state)
            emit({"operation": OPERATION, "phase": "source-placement", "status": "ADOPTED",
                  "retainedDirectory": str(RETAINED),
                  "bindingSha256": adoption["adoption"]["bindingSha256"]})
        env = dict(os.environ)
        env.update({"PATH": str(Path(node).parent) + os.pathsep + env.get("PATH", ""),
                    "NODE_OPTIONS": "--max-old-space-size=256", "PYTHONDONTWRITEBYTECODE": "1",
                    "SF_JOBS_JOURNEY_RESUME": str(RETAINED), "SF_JOBS_JOURNEY_KEEP": "1",
                    "SF_JOBS_JOURNEY_OUTPUT": str(out / "baseline.json")})
        for key in ("NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS", "SF_JOBS_CHECKOUT_PROXY"):
            env.pop(key, None)
        commands = {
            "baseline": [node, source / SOURCE / "sf30-seller-sdk/jobs/native-journey.mjs"],
            "customer": [node, source / SOURCE / "sf88-operator-buyer-cli/job-workspace/continuation.mjs",
                         "--retained", RETAINED, "--out", out / "customer.json"],
            "checkout": [sys.executable, source / SOURCE / "sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py",
                         "--retained", RETAINED, "--node", node, "--out", out / "checkout.json",
                         "--approval", args.approval, *(["--input-files"] if args.input_files else [])],
        }
        for phase in (*PHASES, *(("applications",) if args.applications else ())):
            result_path = out / (phase + ".json")
            result = completed(result_path, phase, args.approval, args.input_files, args.source_commit)
            if result is not None:
                entry = state["phases"].get(phase, {})
                state["phases"][phase] = {**entry, "status": "COMPLETED", "reused": True,
                                          "resultSha256": digest(regular(result_path))}
                emit({"operation": OPERATION, "phase": phase, "status": "REUSED"})
                continue
            if phase == "baseline":
                record = read_json(RETAINED / "merchant-state/records/report:2026.10.json")
                require(record["state"] == "PREPARED" and record["submittedAt"] is None and
                        record["settlement"] is None, "CONTINUE_ORIGINAL_BASELINE_STATE:" + record["state"])
            state["phases"][phase] = {**state["phases"].get(phase, {}), "status": "RUNNING",
                                      "sourceCommit": args.source_commit,
                                      "runtimeProfileId": state["installation"]["profileId"],
                                      **({"argv": [str(value) for value in commands[phase]]} if phase in commands else {})}
            save(state_path, state)
            emit({"operation": OPERATION, "phase": phase, "status": "RUNNING"})
            if phase == "applications":
                started = time.monotonic()
                applications_receiving(source, workspace, out, node, args, env, state, state_path)
                command = {"exitCode": 0, "seconds": round(time.monotonic() - started, 3)}
            else:
                command = execute(commands[phase], logs / phase, cwd=source, env=env, allow_failure=True)
            state["phases"][phase].update(command)
            if command["exitCode"]:
                state["phases"][phase]["status"] = "FAILED"
                raise RuntimeError("ORIGINAL_" + phase.upper() + "_FAILED")
            require(completed(result_path, phase, args.approval, args.input_files, args.source_commit) is not None,
                    "ORIGINAL_PHASE_OUTPUT_REQUIRED:" + phase)
            state["phases"][phase].update({"status": "COMPLETED", "reused": False,
                                          "resultSha256": digest(regular(result_path))})
            save(state_path, state)
            emit({"operation": OPERATION, "phase": phase, "status": "COMPLETED"})
        state["status"] = "COMPLETED"
    except Exception as error:
        state["status"] = "INTERRUPTED" if interrupted else "FAILED"
        state["error"] = {"type": type(error).__name__, "message": str(error)}
        if hasattr(error, "command"):
            state["error"]["command"] = error.command
    finally:
        if restored:
            try:
                if args.input_mode == "completed-core" and placement_adopted:
                    pending = out / (".completed-state-" + str(time.time_ns()) + ".tar.gz")
                    try:
                        captured = completed_tools.capture_completed_core(
                            retained=RETAINED, result_path=out / "baseline.json",
                            result_sha256=state["input"]["coreResult"]["sha256"], output=pending,
                            native_record=Path(state["input"]["coreResult"]["nativeRecordDirectory"]))
                        returned_state = out / "retained-state.tar.gz"
                        os.replace(pending, returned_state)
                        sync_directory(out)
                        state["retainedArchive"] = {key: value for key, value in captured.items() if key != "manifest"}
                        state["retainedArchive"]["path"] = str(returned_state)
                    finally:
                        if pending.exists():
                            pending.unlink()
                else:
                    # If installation or physical adoption failed, return the
                    # exact received state alongside its original capsule and
                    # placement profile. It remains the same pending receive.
                    state["retainedArchive"] = capture_retained(out / "retained-state.tar.gz")
                    if placement is not None:
                        state["retainedArchive"]["placementAdopted"] = False
            except Exception as error:
                state["artifactError"] = {"type": type(error).__name__, "message": str(error)}
                state["status"] = "FAILED"
        state["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save(state_path, state)
        artifacts = []
        for path in sorted(out.rglob("*")):
            if path.is_file() and not path.is_symlink() and path.name not in ("run-artifacts.json", "native-return.tar.gz", ".native-return.pending"):
                artifacts.append({"path": path.relative_to(workspace).as_posix(),
                                  "bytes": path.stat().st_size, "sha256": digest(regular(path)),
                                  "private": True})
        save(out / "run-artifacts.json", {"schema": "stellar-forge.paid-job-native-artifacts.v1",
                                         "operation": OPERATION, "validationOperation": args.validation_operation,
                                         "sourceCommit": args.source_commit, "status": state["status"], "files": artifacts})
        returned = package_outputs(out)
        os.close(lock)
    emit({"operation": OPERATION, "validationOperation": args.validation_operation,
          "status": state["status"], "sourceCommit": args.source_commit,
          "delivery": returned,
          "result": str(state_path), "artifacts": str(out / "run-artifacts.json"),
          "retainedDirectory": str(RETAINED), "error": state.get("error")})
    return 0 if state["status"] == "COMPLETED" else 1


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())

