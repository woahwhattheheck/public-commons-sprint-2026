#!/usr/bin/env python3
"""Run the retained Service receiving entrypoint with an explicitly selected host runtime."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import socket
import subprocess
import sys
import uuid

PACKET_SHA256 = "247ec42540837f4031316f586f7df51344a0bf94e0c61772801c1b949bda4128"
SOURCE_COMMIT = "fe7329e0595d7ab77eddc832bee27785f13e9a4d"
OPERATION = "SCF-SUPPORT-SERVICE-COMMITMENTS-24EA-20261012"


def echo(text):
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except BrokenPipeError:
        # A disconnected progress reader does not cancel the accepted native child.
        descriptor = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(descriptor, sys.stdout.fileno())
        finally:
            os.close(descriptor)


def emit(value):
    echo(json.dumps(value) + "\n")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def process_start(pid):
    try:
        return Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def runtime_identity():
    return {"hostname": socket.gethostname(),
            "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "pidNamespace": os.readlink("/proc/self/ns/pid")}


def write_bytes(path, data):
    # Same durable record pattern as the original managed Support receiving carrier.
    temporary = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    with temporary.open("xb") as stream:
        os.chmod(temporary, 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, value):
    write_bytes(path, (json.dumps(value, indent=2) + "\n").encode())


def read_existing(path):
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return None
    value = json.loads(data)
    if value.get("operationId") != OPERATION:
        raise RuntimeError("The existing native record belongs to a different operation: " + str(path))
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "value": value}


def executable(value):
    selected = shutil.which(value) if "/" not in value else value
    path = Path(selected or value).expanduser().resolve()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError("Selected native executable is unavailable: " + str(path))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="Original persistent native case/checkpoint directory.")
    parser.add_argument("--work-dir", required=True, help="Host-local directory for the verified source and browser profile.")
    parser.add_argument("--node", required=True, help="Installed Node executable or command.")
    parser.add_argument("--chromium", required=True, help="Installed Chromium executable.")
    parser.add_argument("--playwright-module", required=True, help="Installed Playwright JavaScript module.")
    parser.add_argument("--node-modules", required=True, help="Existing application dependency directory.")
    parser.add_argument("--source-packet", default="-", help="Exact source-map.json file; '-' reads its bytes from stdin.")
    parser.add_argument("--inspect", action="store_true", help="Read the original native checkpoint/result without writing or launching.")
    args = parser.parse_args()
    packet_bytes = sys.stdin.buffer.read() if args.source_packet == "-" else Path(args.source_packet).read_bytes()
    if hashlib.sha256(packet_bytes).hexdigest() != PACKET_SHA256:
        raise RuntimeError("Original Service source packet bytes differ")
    packet = json.loads(packet_bytes)
    if packet.get("operationId") != OPERATION or packet.get("authoredCommit") != SOURCE_COMMIT or len(packet["files"]) != 527:
        raise RuntimeError("Unexpected Service receiving source")
    if set(packet["files"]) != set(packet["file_blobs"]):
        raise RuntimeError("The complete source and original blob index differ")
    predecessors = {}
    for retained in packet.get("previousSelections", []):
        index = retained.get("file_blobs")
        digest = retained.get("packetSha256")
        if (not isinstance(index, dict) or retained.get("files") != len(index)
                or not isinstance(digest, str) or len(digest) != 64
                or any(value not in "0123456789abcdef" for value in digest)
                or digest in predecessors):
            raise RuntimeError("The retained predecessor selection is malformed")
        if any(packet["file_blobs"].get(name) != blob for name, blob in index.items()):
            raise RuntimeError("The complete selection changed an original predecessor file")
        predecessors[digest] = index

    root = Path(args.work_dir).expanduser().resolve()
    source = root / "source"
    native = Path(args.directory).expanduser().resolve()
    if native == root or native == source:
        raise RuntimeError("Select separate native case and source directories")
    existing = []
    for name in ("service-receiving-checkpoint.json", "service-native-run.json"):
        item = read_existing(native / name)
        if item:
            value = item["value"]
            if value.get("directory") != str(native):
                raise RuntimeError("Retain the original native directory recorded in " + str(item["path"]) + ": " + str(value.get("directory")))
            existing.append({key: item[key] for key in ("path", "sha256")} | {
                "caseId": value.get("caseId"), "result": value.get("result"),
                "completedAt": value.get("completedAt"), "phases": value.get("phases", {}),
                "sourceSelections": value.get("sourceSelections", []),
            })
    if len({item["caseId"] for item in existing}) > 1:
        raise RuntimeError("The original checkpoint and completed result contain different cases")
    owner = read_existing(native / "native-active.json")
    owner_summary = None if owner is None else {
        key: owner["value"].get(key) for key in
        ("attemptId", "host", "phase", "pid", "processStart", "controllerPid", "controllerProcessStart", "startedAt", "finishedAt")}
    emit({"event": "service-existing-native-read", "operationId": OPERATION,
          "directory": str(native), "records": existing, "active": owner_summary, "nativeChildStarted": False})
    if args.inspect:
        return 0

    node, chromium = executable(args.node), executable(args.chromium)
    deps = Path(args.node_modules).expanduser().resolve()
    playwright = Path(args.playwright_module).expanduser().resolve()
    if not deps.is_dir() or not playwright.is_file():
        raise RuntimeError("Select the existing application dependencies and Playwright module")

    for path in (root, source, native):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    host_identity = runtime_identity()
    lock_path = native / "native-receiving.lock"
    with lock_path.open("a+b") as lease:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The original Service directory already has an active receiving controller")
        active_path = native / "native-active.json"
        previous = read_existing(active_path)
        if previous:
            prior = previous["value"]
            if prior.get("phase") in ("STARTING", "RUNNING") and prior.get("host") == host_identity:
                pid, expected_start = prior.get("pid"), prior.get("processStart")
                actual_start = process_start(pid) if pid else None
                if actual_start is not None and (expected_start is None or actual_start == expected_start):
                    raise RuntimeError("Original Service child is still active: " + str(pid))
        # Reconcile the same records under the inherited case lease before any source/native write.
        selected_records = {item["path"]: item["sha256"] for item in existing}
        for name in ("service-receiving-checkpoint.json", "service-native-run.json"):
            path = native / name
            current = read_existing(path)
            if (current["sha256"] if current else None) != selected_records.get(str(path)):
                raise RuntimeError("The original Service checkpoint changed during receiving selection")

        for name, content in packet["files"].items():
            parts = PurePosixPath(name)
            if parts.is_absolute() or ".." in parts.parts or "\\" in name:
                raise RuntimeError("Unsafe source path")
            data = content.encode("utf-8")
            observed = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if observed != packet["file_blobs"][name]:
                raise RuntimeError("Source blob mismatch " + name)
            target = source.joinpath(*parts.parts)
            if not target.resolve().is_relative_to(source) or target.is_symlink():
                raise RuntimeError("The selected source path leaves its retained source directory")
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target.exists():
                if target.read_bytes() != data:
                    raise RuntimeError("Different selected source already exists " + name)
            else:
                write_bytes(target, data)

        entry = source / packet["nativeEntry"]
        if packet["nativeEntry"] not in packet["files"] or not entry.is_file():
            raise RuntimeError("The original native entrypoint is absent")
        modules = source / "node_modules"
        if modules.exists() or modules.is_symlink():
            if modules.resolve() != deps:
                raise RuntimeError("The existing source dependency selection differs")
        else:
            modules.symlink_to(deps, target_is_directory=True)
        browser = root / "browser"
        browser.mkdir(exist_ok=True, mode=0o700)
        browser_link = native / "browser"
        browser_recovery = None
        if not browser_link.exists() and not browser_link.is_symlink():
            browser_link.symlink_to(browser, target_is_directory=True)
        elif browser_link.is_symlink() and not browser_link.exists():
            prior_custody = read_existing(native / "runtime-custody.json")
            prior_profile = prior_custody["value"].get("browserProfile") if prior_custody else None
            if (not prior_custody or prior_custody["value"].get("commit") != SOURCE_COMMIT
                    or not isinstance(prior_profile, str) or not Path(prior_profile).is_absolute()
                    or Path(prior_profile).resolve() != browser_link.resolve()):
                raise RuntimeError("The missing browser profile does not match the original runtime custody")
            # The ephemeral profile disappeared; the original case/checkpoint remain in native.
            replacement = native / (".browser-pending-" + uuid.uuid4().hex)
            replacement.symlink_to(browser, target_is_directory=True)
            try:
                os.replace(replacement, browser_link)
            finally:
                replacement.unlink(missing_ok=True)
            browser_recovery = {"priorProfile": prior_profile, "profile": str(browser),
                                "runtimeCustodySha256": prior_custody["sha256"], "recoveredAt": now()}

        selection = {
            "operationId": OPERATION, "commit": SOURCE_COMMIT, "packetSha256": PACKET_SHA256,
            "source": str(source), "native": str(native), "files": packet["file_blobs"],
            "browserProfile": str(browser_link.resolve()),
            "runtime": {"node": str(node), "chromium": str(chromium),
                        "playwrightModule": str(playwright), "nodeModules": str(deps)},
        }
        if browser_recovery is not None:
            selection["browserProfileRecovery"] = browser_recovery
        for path in (root / "source-selection.json", native / "runtime-custody.json"):
            prior = read_existing(path)
            if prior:
                value = prior["value"]
                if value.get("commit") != SOURCE_COMMIT:
                    raise RuntimeError("The existing runtime custody selects a different original source")
                prior_packet = value.get("packetSha256")
                prior_index = value.get("files")
                if prior_packet == PACKET_SHA256:
                    expected_index = packet["file_blobs"]
                elif prior_packet in predecessors:
                    expected_index = predecessors[prior_packet]
                elif prior_packet is None:
                    # Legacy custody may precede the explicit packet hash. Its
                    # retained index still has to be one complete known selection.
                    candidates = [packet["file_blobs"], *predecessors.values()]
                    expected_index = next((index for index in candidates if prior_index == index), None)
                    if expected_index is None and prior_index is None:
                        expected_index = packet["file_blobs"]
                    if expected_index is None:
                        raise RuntimeError("The legacy runtime custody contains a different original file index")
                else:
                    raise RuntimeError("The existing runtime custody selects different original packet bytes")
                if prior_index is not None and prior_index != expected_index:
                    raise RuntimeError("The existing runtime custody contains a different original file index")
                if prior_packet != PACKET_SHA256:
                    # Every selected file above has been checked against its
                    # original Git blob, including the complete unchanged predecessor.
                    selection.setdefault("adoptedCustody", []).append({
                        "path": str(path), "sha256": prior["sha256"],
                        "fromPacketSha256": prior_packet,
                        "verifiedPredecessorFiles": len(expected_index),
                        "verifiedFiles": len(packet["files"])})
        write_json(root / "source-selection.json", selection)
        write_json(native / "runtime-custody.json", {key: value for key, value in selection.items() if key != "files"})
        emit({"event": "service-source-ready", "commit": SOURCE_COMMIT, "files": len(packet["files"]),
              "native": str(native), "sharedFreeBytes": shutil.disk_usage(native).free,
              "sourceFreeBytes": shutil.disk_usage(source).free})
        argv = [str(node), str(entry), "--directory", str(native), "--source-commit", SOURCE_COMMIT,
                "--chromium", str(chromium), "--playwright-module", str(playwright)]
        attempt = uuid.uuid4().hex
        active = {
            "schema": "stellar-forge.service-receiving-active.v1",
            "operationId": OPERATION, "attemptId": attempt, "sourceCommit": SOURCE_COMMIT,
            "host": host_identity, "work": str(root), "directory": str(native),
            "startedAt": now(), "phase": "STARTING",
            "controllerPid": os.getpid(), "controllerProcessStart": process_start(os.getpid()),
            "argv": argv, "packetSha256": PACKET_SHA256, "files": len(packet["files"]),
        }
        write_json(active_path, active)
        log = native / "service-native-output.log"
        child = None
        prior_handlers = {}
        interrupted = {"signal": None}

        def forward(signum, _frame):
            interrupted["signal"] = signum
            if child and child.poll() is None:
                try:
                    os.killpg(child.pid, signum)
                except ProcessLookupError:
                    pass

        def close_owned_group():
            if child is None:
                return
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            if child.poll() is None:
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()

        def retain_active():
            write_json(active_path, active)
            attempts = native / "native-attempts"
            attempts.mkdir(exist_ok=True, mode=0o700)
            write_json(attempts / (attempt + ".json"), active)

        try:
            for signum in (signal.SIGINT, signal.SIGTERM):
                prior_handlers[signum] = signal.signal(signum, forward)
            env = dict(os.environ)
            env.update({"PATH": str(node.parent) + os.pathsep + env.get("PATH", ""),
                        "TMPDIR": str(root), "PYTHONDONTWRITEBYTECODE": "1"})
            with log.open("ab", buffering=0) as output:
                os.chmod(log, 0o600)
                if interrupted["signal"] is not None:
                    raise InterruptedError("Service receiving interrupted before child creation")
                child = subprocess.Popen(argv, cwd=str(source), env=env, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, start_new_session=True,
                                         pass_fds=(lease.fileno(),))
                if interrupted["signal"] is not None:
                    forward(interrupted["signal"], None)
                active.update({"phase": "RUNNING", "pid": child.pid,
                               "processStart": process_start(child.pid)})
                write_json(active_path, active)
                emit({"event": "service-original-native-started", "pid": child.pid,
                      "attemptId": attempt, "argv": argv})
                for block in child.stdout:
                    output.write(block)
                    echo(block.decode("utf-8", errors="replace"))
                code = child.wait()
            if code:
                close_owned_group()
            else:
                completed = read_existing(native / "service-native-run.json")
                if not completed or completed["value"].get("result") != "PASS":
                    raise RuntimeError("Original native journey exited without its completed Service receiving result")
            active.update({"phase": "COMPLETE" if code == 0 else "FAILED",
                           "exitCode": code, "finishedAt": now()})
            if interrupted["signal"] is not None:
                active.update({"phase": "INTERRUPTED", "signal": interrupted["signal"]})
            retain_active()
            emit({"event": "service-original-native-completed", "pid": child.pid,
                  "exitCode": code, "phase": active["phase"], "attemptId": attempt,
                  "checkpoint": str(native / "service-receiving-checkpoint.json"),
                  "result": str(native / "service-native-run.json")})
            return code if code >= 0 else 128 - code
        except BaseException as error:
            close_owned_group()
            active.update({"phase": "CONTROLLER_ERROR", "error": str(error), "finishedAt": now()})
            if interrupted["signal"] is not None:
                active.update({"phase": "INTERRUPTED", "signal": interrupted["signal"],
                               "exitCode": 128 + interrupted["signal"]})
            retain_active()
            if interrupted["signal"] is not None:
                return 128 + interrupted["signal"]
            raise
        finally:
            for signum, handler in prior_handlers.items():
                signal.signal(signum, handler)


if __name__ == "__main__":
    sys.exit(main())
