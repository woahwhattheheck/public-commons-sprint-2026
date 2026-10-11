#!/usr/bin/env python3
"""MIT. A PTY for one original managed command; the original worker owns its lease."""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import sys
import time
import uuid
from datetime import datetime, timezone

def now():
    return datetime.now(timezone.utc).isoformat()

def save(path, value):
    temporary = path.with_name(path.name + ".pending-" + str(uuid.uuid4()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass

def read(path, maximum=65536):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not __import__("stat").S_ISREG(info.st_mode) or info.st_size > maximum or info.st_mode & 0o077:
            raise ValueError("Private terminal record required")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            return json.loads(source.read(maximum + 1))
    finally:
        os.close(descriptor)

def identity(pid):
    try:
        text = Path("/proc/" + str(pid) + "/stat").read_text()
        fields = text[text.rfind(")") + 2:].split()
        return fields[19] if fields[0] != "Z" else None
    except OSError:
        return None

def main(directory):
    root = Path(directory)
    expected = (root / "worker.lock").stat()
    inherited = os.fstat(3)
    if (expected.st_dev, expected.st_ino) != (inherited.st_dev, inherited.st_ino):
        raise ValueError("Original worker lease required")
    launch = read(root / "command-launch.json")
    request = read(root / "request.json")
    if request.get("operation") != "managed-run" or request.get("terminal") is not True:
        raise ValueError("Original terminal command required")
    argv = [request["releaseDirectory"] + "/forge.mjs", "run", request["command"], "--"] + request["args"]
    if launch["args"] != argv or launch["cwd"] != request["homeDirectory"] or launch["digest"] != request["releaseDigest"]:
        raise ValueError("Original command changed")
    executable = launch["executable"]
    pid, master = pty.fork()
    if pid == 0:
        os.set_inheritable(3, True)
        os.chdir(launch["cwd"])
        tty = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
        os.close(tty)
        save(root / "terminal-device.json", {
            "schema": "stellar-forge.application-terminal-device.v1",
            "pid": os.getpid(), "path": os.ttyname(0),
            "inputTTY": os.isatty(0), "outputTTY": os.isatty(1), "observedAt": now(),
        })
        os.execve(executable, [executable] + argv, os.environ)
    os.set_blocking(master, False)
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    exit_status = None
    closed = False
    try:
        save(root / "terminal-process.json", {
            "schema": "stellar-forge.application-terminal-process.v1",
            "startedAt": now(), "operationId": root.name,
            "bridge": {"pid": os.getpid(), "processStart": identity(os.getpid())},
            "original": {"pid": pid, "processStart": identity(pid), "executable": executable,
                         "args": argv, "cwd": launch["cwd"]},
            "terminal": os.ttyname(master), "inputMode": "explicit-operator",
        })
        while not closed or exit_status is None:
            if exit_status is None:
                result_pid, status = os.waitpid(pid, os.WNOHANG)
                if result_pid:
                    exit_status = status
            readable, _, _ = select.select([] if closed else [master], [], [], 0.1)
            if readable:
                try:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        closed = True
                    else:
                        view = memoryview(chunk)
                        while view:
                            count = os.write(1, view)
                            view = view[count:]
                except OSError as error:
                    if error.errno == errno.EIO:
                        closed = True
                    elif error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                        raise
            if stopping or exit_status is not None:
                continue
            for pending in sorted((root / "terminal-pending").glob("*.json")):
                packet = read(pending, 32768)
                input_id = packet["inputId"]
                if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", input_id):
                    raise ValueError("Terminal input identity changed")
                receipt_path = root / "terminal-inputs" / (input_id + ".json")
                receipt = read(receipt_path)
                data = packet["text"].encode()
                if hashlib.sha256(data).hexdigest() != receipt["sha256"] or len(data) != receipt["bytes"] or len(data) > 4096:
                    raise ValueError("Terminal input bytes changed")
                if receipt["state"] != "QUEUED":
                    pending.unlink()
                    continue
                # Claim is durable before the first write. A lost bridge must
                # never repeat a possibly delivered approval or command.
                receipt.update(state="DISPATCHING", dispatchedAt=now())
                save(receipt_path, receipt)
                count = 0
                try:
                    while count < len(data):
                        _, writable, _ = select.select([], [master], [], 1)
                        if not writable:
                            continue
                        count += os.write(master, data[count:])
                    receipt.update(state="SENT", sentAt=now(), writtenBytes=count)
                except OSError as error:
                    receipt.update(state="DELIVERY_UNCERTAIN", writtenBytes=count, error=str(error))
                save(receipt_path, receipt)
                pending.unlink()
        result = {"schema": "stellar-forge.application-terminal-exit.v1", "completedAt": now(),
                  "operationId": root.name, "pid": pid, "stopped": stopping,
                  "exitCode": os.waitstatus_to_exitcode(exit_status) if exit_status is not None else None}
        save(root / "terminal-exit.json", result)
        code = result["exitCode"]
        return code if isinstance(code, int) and code >= 0 else 128 + (-code if isinstance(code, int) else 1)
    except BaseException:
        stop(signal.SIGTERM, None)
        if exit_status is None:
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
        raise
    finally:
        os.close(master)

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--operation":
        raise SystemExit("Use the original managed command runner")
    raise SystemExit(main(sys.argv[2]))
