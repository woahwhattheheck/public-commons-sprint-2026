#!/usr/bin/env python3
"""MIT. Execute one original installed ODK managed receiving with an OS-owned lock."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

OPERATION = "CB57-ODK-MANAGED-RECEIVING"

def private_directory(raw):
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("Use an absolute original receiving directory.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or path.resolve() != path:
        raise ValueError("Use a canonical private directory.")
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("The original receiving directory must be owned and private.")
    return path

def write_json(path, value):
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    temporary = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temporary.unlink(missing_ok=True)

def stop_original(child):
    if child.poll() is not None:
        return child.returncode
    # Node performs its exact Playwright/managed-owner cleanup on this signal.
    try:
        child.send_signal(signal.SIGTERM)
    except ProcessLookupError:
        return child.wait()
    try:
        return child.wait(timeout=55)
    except subprocess.TimeoutExpired:
        # This group was created by this retained Popen, never selected by a PID scan.
        os.killpg(child.pid, signal.SIGTERM)
        try:
            return child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            return child.wait(timeout=10)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", required=True, help="Existing absolute Node.js 24+ executable")
    parser.add_argument("--package", required=True, help="Original installed product package directory")
    parser.add_argument("--work-directory", required=True, help="Same private original receiving directory")
    parser.add_argument("--playwright", required=True, help="Existing absolute Playwright ESM or CJS module")
    parser.add_argument("--chromium", required=True, help="Existing absolute Chromium executable")
    parser.add_argument("--driver", default=str(Path(__file__).with_name("receive-managed.mjs")))
    parser.add_argument("--driver-sha256", required=True, help="Reviewed exact UTF-8 driver SHA-256")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args()
    if not 60 <= args.timeout_seconds <= 3600:
        parser.error("Use a bounded native receiving deadline of 60–3600 seconds.")
    for field in ("node", "package", "playwright", "chromium", "driver"):
        if not Path(getattr(args, field)).is_absolute():
            parser.error("Use the actual absolute host path for --" + field)
    driver = Path(args.driver).resolve()
    if hashlib.sha256(driver.read_bytes()).hexdigest() != args.driver_sha256:
        raise ValueError("The selected original driver differs from the reviewed SHA-256.")
    root = private_directory(args.work_directory)
    private = private_directory(str(root / "private"))
    lock_path = root / "managed-receiving.lock"
    lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    child = None
    original_handlers = {}
    disposition = {}
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("Keep the original private lock file.")
        selection = {
            "schema": "stellar-forge.odk-managed-receiving-launch.v1",
            "operationId": OPERATION,
            "node": str(Path(args.node).resolve()),
            "package": str(Path(args.package).resolve()),
            "workDirectory": str(root),
            "playwright": str(Path(args.playwright).resolve()),
            "chromium": str(Path(args.chromium).resolve()),
            "driverSha256": args.driver_sha256,
        }
        selection_path = private / "launch-selection.json"
        if selection_path.exists():
            if json.loads(selection_path.read_text()) != selection:
                raise ValueError("Continue the original source, host and input selection.")
        else:
            write_json(selection_path, selection)
        owner = {"operationId": OPERATION, "pid": os.getpid(), "startedAt": time.time(), "selection": selection}
        os.ftruncate(lock, 0)
        os.write(lock, (json.dumps(owner) + "\n").encode())
        os.fsync(lock)
        def interrupted(signum, _frame):
            raise KeyboardInterrupt("Original receiving stopped by signal " + str(signum))
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            original_handlers[signum] = signal.signal(signum, interrupted)
        command = [selection["node"], str(driver), "--package", selection["package"],
                   "--work-directory", str(root), "--playwright", selection["playwright"],
                   "--chromium", selection["chromium"], "--operation-id", OPERATION]
        environment = dict(os.environ)
        environment["CENTRAL_MANAGED_RECEIVING_LOCK_PARENT"] = str(os.getpid())
        with open(private / "programme.stdout", "ab", buffering=0) as stdout, \
                open(private / "programme.stderr", "ab", buffering=0) as stderr:
            os.chmod(private / "programme.stdout", 0o600)
            os.chmod(private / "programme.stderr", 0o600)
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     env=environment, start_new_session=True)
            owner["childPid"] = child.pid
            write_json(private / "launch-owner.json", owner)
            code = child.wait(timeout=args.timeout_seconds)
        disposition = {"operationId": OPERATION, "childPid": child.pid, "exitCode": code, "closed": True}
        if code:
            raise RuntimeError("Original managed receiving exited " + str(code) + ". Read its retained stderr and operation.json.")
        result_path = root / "delivery" / "managed-receiving.json"
        result = json.loads(result_path.read_text())
        if result.get("status") != "COMPLETE" or result.get("operationId") != OPERATION:
            raise ValueError("The original programme has no complete matching result.")
        print(json.dumps({"operationId": OPERATION, "status": result["status"], "result": str(result_path),
                          "resultSha256": hashlib.sha256(result_path.read_bytes()).hexdigest(),
                          "workspaceId": result["originalWorkspaceId"], "archive": result["archive"],
                          "exitCode": code}))
    finally:
        # Do not allow a second cancellation to skip closure of this exact child.
        for signum in original_handlers:
            signal.signal(signum, signal.SIG_IGN)
        primary = sys.exc_info()[1]
        cleanup_error = None
        try:
            if child is not None:
                code = stop_original(child)
                disposition.update({"operationId": OPERATION, "childPid": child.pid, "exitCode": code, "closed": True})
                write_json(private / "launch-result.json", disposition)
        except Exception as error:
            cleanup_error = error
        finally:
            for signum, handler in original_handlers.items():
                signal.signal(signum, handler)
            os.close(lock)
        if cleanup_error is not None:
            if primary is None:
                raise cleanup_error
            print(json.dumps({"operationId": OPERATION, "cleanupError": {
                "type": type(cleanup_error).__name__, "message": str(cleanup_error)}}), file=sys.stderr)

if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"operationId": OPERATION, "status": "INTERRUPTED",
                          "error": {"type": type(error).__name__, "message": str(error)}}), file=sys.stderr)
        sys.exit(1)
