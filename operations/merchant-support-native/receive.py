#!/usr/bin/env python3
"""Run the original managed Support/Grant receiving pipeline on an equipped Linux host."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import uuid

OPERATION = "SCF-MERCHANT-SUPPORT-APPLICATIONS-24EAD3-20261012"
DRIVERS = ("native-journey.mjs", "run-native.mjs", "grant-receiving.mjs",
           "grant-completion-native.mjs")
DISTRIBUTION = "stellar/scf-starforge-20261009/distribution/"
DRIVER_SOURCE = "operations/merchant-support-native/"


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


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def write_bytes(path, data):
    temporary = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    with temporary.open("xb") as handle:
        os.chmod(temporary, 0o600)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, value):
    write_bytes(path, (json.dumps(value, indent=2) + "\n").encode())


def directory(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("Use an absolute directory: " + str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Use a real owned directory: " + str(path))
    return path.resolve()


def executable(value):
    found = shutil.which(value)
    if found is None or not Path(found).is_file():
        raise ValueError("Executable unavailable: " + value)
    return str(Path(found).resolve())


def process_start(pid):
    try:
        # After the final ')' field 3 is first; field 22 is process start time.
        return Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def runtime_identity():
    return {"hostname": socket.gethostname(),
            "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "pidNamespace": os.readlink("/proc/self/ns/pid")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True,
                        help="Existing full checkout or original hydrated bare Git cache")
    parser.add_argument("--source-commit", required=True, help="Exact 40-character Git commit")
    parser.add_argument("--directory", required=True,
                        help="Original private receiving output, case and checkpoint directory")
    parser.add_argument("--work", required=True,
                        help="Owned writable root for reproducible source, npm cache and installed runtime")
    parser.add_argument("--node", default="node", help="Actual equipped Node executable")
    parser.add_argument("--chromium", required=True, help="Actual equipped Chromium executable")
    parser.add_argument("--playwright-module", required=True,
                        help="Absolute installed Playwright module entrypoint")
    parser.add_argument("--prepare-only", action="store_true",
                        help="Run original producer and installer; leave the same browser journey for continuation")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise ValueError("--source-commit must name one exact lowercase Git commit")
    repository = Path(args.repository).expanduser().resolve(strict=True)
    if not repository.is_dir():
        raise ValueError("--repository must be an existing Git directory")
    node = executable(args.node)
    browser = executable(args.chromium)
    playwright = Path(args.playwright_module).expanduser()
    if not playwright.is_absolute() or not playwright.is_file():
        raise ValueError("--playwright-module must be an existing absolute module file")
    playwright = playwright.resolve()
    host_identity = runtime_identity()
    stage = directory(args.directory)
    work_root = directory(args.work)

    def git(*argv):
        return subprocess.check_output(
            ["git", "--no-lazy-fetch", "-C", str(repository), *argv],
            stderr=subprocess.PIPE)

    commit = git("rev-parse", args.source_commit + "^{commit}").decode().strip()
    if commit != args.source_commit:
        raise ValueError("Git did not return the selected source commit")
    git("cat-file", "-e", commit + ":" + DISTRIBUTION + "build.mjs")
    lock_path = stage / "native-receiving.lock"
    with lock_path.open("a+b") as lease:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The original receiving directory already has an active controller")
        previous = read_json(stage / "native-active.json")
        if (previous and previous.get("phase") in ("RUNNING", "STARTING")
                and previous.get("host") == host_identity):
            pid = previous.get("pid")
            start = previous.get("processStart")
            if pid and process_start(pid) is not None:
                if start is None or process_start(pid) == start:
                    raise RuntimeError("Original receiving child is still active: " + str(pid))
        request_path = stage / "native-receiving-request.json"
        request = read_json(request_path)
        if request and request.get("operationId") != OPERATION:
            raise ValueError("The output directory belongs to another receiving operation")
        legacy_selection = read_json(stage / "native-selection.json", {})
        prior_source = request.get("sourceCommit") if request else legacy_selection.get("sourceCommit")
        if prior_source and prior_source != commit:
            git("merge-base", "--is-ancestor", prior_source, commit)
        work = directory(str(work_root / ("source-" + commit)))
        if not request or request.get("sourceCommit") != commit:
            history = list(request.get("sourceHistory", [])) if request else []
            if prior_source and prior_source != commit:
                history.append({"sourceCommit": prior_source,
                                "selectedAt": request.get("selectedAt") if request else
                                    (previous or {}).get("startedAt"),
                                "retainedFrom": "native-receiving-request.json" if request else
                                    "native-selection.json"})
            request = {"schema": "stellar-forge.support-native-request.v1",
                       "operationId": OPERATION, "sourceCommit": commit,
                       "sourceHistory": history, "selectedAt": now()}
            save(request_path, request)
        builder = directory(str(work / "builder"))
        driver_blobs = {}
        for name in DRIVERS:
            path = DRIVER_SOURCE + name
            content = git("show", commit + ":" + path)
            write_bytes(stage / name, content)
            driver_blobs[name] = git("rev-parse", commit + ":" + path).decode().strip()
        builder_count = 0
        for path in git("ls-tree", "-r", "--name-only", commit, "--", DISTRIBUTION).decode().splitlines():
            name = path[len(DISTRIBUTION):]
            if "/" not in name and (name.endswith(".mjs") or name == "runtime-unpack.py"):
                write_bytes(builder / name, git("show", commit + ":" + path))
                builder_count += 1
        if not (builder / "build.mjs").is_file():
            raise ValueError("The original distribution builder was not selected")
        selection = {"sourceCommit": commit, "cache": str(repository), "work": str(work),
                     "stage": str(stage), "builder": str(builder), "browser": browser,
                     "playwright": str(playwright), "grantReceiving": True,
                     "prepareOnly": args.prepare_only}
        selection_path = work / "selection.json"
        save(selection_path, selection)
        save(stage / "native-selection.json", selection)
        attempt = uuid.uuid4().hex
        argv = [node, str(stage / "run-native.mjs"), str(selection_path)]
        active = {"schema": "stellar-forge.support-receiving-active.v1",
                  "operationId": OPERATION, "attemptId": attempt, "sourceCommit": commit,
                  "host": host_identity,
                  "work": str(work), "startedAt": now(), "phase": "STARTING",
                  "controllerPid": os.getpid(), "controllerProcessStart": process_start(os.getpid()),
                  "argv": argv, "driverBlobs": driver_blobs, "builderFiles": builder_count,
                  "prepareOnly": args.prepare_only}
        save(stage / "native-active.json", active)
        env = dict(os.environ)
        env.update({"PATH": str(Path(node).parent) + os.pathsep + env.get("PATH", ""),
                    "TMPDIR": str(work), "NODE_OPTIONS": "--max-old-space-size=512",
                    "PYTHONDONTWRITEBYTECODE": "1"})
        emit({"phase": "SOURCE_READY", "sourceCommit": commit,
                          "driverBlobs": driver_blobs, "work": str(work)})
        log_path = stage / "native-run.log"
        if log_path.exists():
            retained = directory(str(stage / "native-attempts"))
            os.replace(log_path, retained / ("before-" + attempt + ".log"))
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

        try:
            for signum in (signal.SIGINT, signal.SIGTERM):
                prior_handlers[signum] = signal.signal(signum, forward)
            with log_path.open("w") as log:
                os.chmod(log_path, 0o600)
                if interrupted["signal"] is not None:
                    raise InterruptedError("Receiving interrupted before child creation")
                child = subprocess.Popen(argv, cwd=work, env=env, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, text=True, bufsize=1,
                                         start_new_session=True, pass_fds=(lease.fileno(),))
                if interrupted["signal"] is not None:
                    forward(interrupted["signal"], None)
                active.update({"phase": "RUNNING", "pid": child.pid,
                               "processStart": process_start(child.pid)})
                save(stage / "native-active.json", active)
                emit({"phase": "RUNNING", "pid": child.pid,
                                  "attemptId": attempt, "sourceCommit": commit})
                for line in child.stdout:
                    log.write(line)
                    log.flush()
                    echo(line)
                code = child.wait()
            if code == 0 and not args.prepare_only:
                outcome = read_json(stage / "native-result.json", {})
                if outcome.get("status") != "COMPLETE":
                    raise RuntimeError("Original native journey exited without its completed receiving result")
            active.update({"phase": ("PREPARED" if args.prepare_only else "COMPLETE") if code == 0 else "FAILED",
                           "exitCode": code, "finishedAt": now()})
            if interrupted["signal"] is not None:
                active["signal"] = interrupted["signal"]
            save(stage / "native-active.json", active)
            emit({"phase": active["phase"], "exitCode": code,
                              "selection": str(work / "journey-selection.json"),
                              "result": str(stage / "native-result.json")})
            return code if code >= 0 else 128 - code
        except BaseException as error:
            if child and child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                except ProcessLookupError:
                    pass
            active.update({"phase": "CONTROLLER_ERROR", "error": str(error), "finishedAt": now()})
            if interrupted["signal"] is not None:
                active.update({"phase": "INTERRUPTED", "signal": interrupted["signal"],
                               "exitCode": 128 + interrupted["signal"]})
            save(stage / "native-active.json", active)
            if interrupted["signal"] is not None:
                return 128 + interrupted["signal"]
            raise
        finally:
            for signum, handler in prior_handlers.items():
                signal.signal(signum, handler)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr.decode(errors="replace"), file=sys.stderr)
        raise
