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

_process_paths = {}

def process_identity(pid):
    """Resolve this process or its original child using the child's private handoff."""
    try:
        own_text = Path("/proc/self/stat").read_text()
        own_proc_pid = int(own_text.split(" ", 1)[0])
        own_status = Path("/proc/self/status").read_text()
        own_ids = next(line.split()[1:] for line in own_status.splitlines()
                       if line.startswith("NSpid:"))
        depth = len(own_ids) - 1
        if pid == os.getpid():
            candidates = [own_proc_pid]
        elif own_proc_pid == os.getpid():
            candidates = [pid]
        else:
            # Some kernels omit /proc/PID/task/TID/children. The original fork
            # child supplies its mounted-procfs PID over a private pipe before
            # exec; the parent still verifies its namespace, parent and start.
            candidates = [_process_paths[pid]] if pid in _process_paths else []
        for proc_pid in candidates:
            base = Path("/proc/" + str(proc_pid))
            try:
                status = base.joinpath("status").read_text()
                ids = next(line.split()[1:] for line in status.splitlines() if line.startswith("NSpid:"))
                if len(ids) <= depth or int(ids[depth]) != pid:
                    continue
                text = base.joinpath("stat").read_text()
                fields = text[text.rfind(")") + 2:].split()
                if pid != os.getpid() and int(fields[1]) != own_proc_pid:
                    continue
                # Kernel APIs below use this parent's PID namespace. The procfs
                # fields above may refer to the namespace which mounted /proc.
                group, session = os.getpgid(pid), os.getsid(pid)
                _process_paths[pid] = proc_pid
                return {"processStart": fields[19], "state": fields[0],
                        "parent": os.getppid() if pid == os.getpid() else os.getpid(),
                        "group": group, "session": session, "procPid": proc_pid,
                        "procGroup": int(fields[2]), "procSession": int(fields[3]),
                        "pidNamespace": os.readlink("/proc/self/ns/pid")}
            except (OSError, ValueError, IndexError, StopIteration):
                continue
    except (OSError, ValueError, IndexError, StopIteration):
        pass
    return None

def identity(pid):
    observed = process_identity(pid)
    return observed["processStart"] if observed and observed["state"] != "Z" else None

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
    identity_reader, identity_writer = os.pipe()
    try:
        pid, master = pty.fork()
    except BaseException:
        os.close(identity_reader)
        os.close(identity_writer)
        raise
    if pid == 0:
        os.close(identity_reader)
        observed = process_identity(os.getpid())
        if observed is None:
            raise RuntimeError("Original terminal could not observe its own process identity")
        packet = (json.dumps({"pid": os.getpid(), **observed}) + "\n").encode()
        try:
            if len(packet) > 4096 or os.write(identity_writer, packet) != len(packet):
                raise RuntimeError("Original terminal identity handoff was incomplete")
        finally:
            os.close(identity_writer)
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
    os.close(identity_writer)
    os.set_blocking(identity_reader, False)
    os.set_blocking(master, False)
    os.set_blocking(1, False)
    original = None
    original_start = None
    stopping = False
    stop_reason = None
    stop_at = None
    term_sent = False
    kill_sent = False
    term_attempted = False
    kill_attempted = False
    waitable = False
    reaped_status = None
    closed = False
    discarded_output = 0
    pending_output = bytearray()
    grace_seconds = 5.0
    input_seconds = 10.0

    def request_stop(reason, explicit=False):
        nonlocal stopping, stop_reason, stop_at
        stopping = stopping or explicit
        if stop_at is None:
            stop_at = time.monotonic()
            stop_reason = reason

    def stop(signum, frame):
        request_stop("operator_signal", explicit=True)

    def probe_child():
        nonlocal waitable
        if not waitable:
            # Keep the exited original child unreaped until PTY cleanup is
            # complete. Its PID cannot be recycled while we address its group.
            observed = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            waitable = observed is not None and observed.si_pid == pid
        return waitable

    def signal_original(signum):
        nonlocal original_start
        observed = process_identity(pid)
        if original_start is None and observed and observed["parent"] == os.getpid():
            # This is still our own unreaped child, so a delayed first /proc
            # observation cannot accidentally adopt a recycled process.
            original_start = observed["processStart"]
        if observed and observed["processStart"] != original_start:
            return None
        # We have not reaped this pty.fork child. Even if procfs is temporarily
        # unavailable, its PID cannot be reused. Child/session APIs still let
        # exception cleanup stop only this original process group.
        try:
            group, session = os.getpgid(pid), os.getsid(pid)
        except ProcessLookupError:
            return False
        if reaped_status is not None:
            return False
        if group != pid or session != pid:
            # pty.fork's child may still be establishing its own session.
            # Never signal the parent's group; retry on the next loop.
            return None
        try:
            os.killpg(pid, signum)
        except ProcessLookupError:
            return False
        return True

    def tick():
        nonlocal term_sent, kill_sent, term_attempted, kill_attempted
        if probe_child() and (not closed or pending_output):
            request_stop("original_child_exited")
        if stop_at is None:
            return
        if not term_attempted:
            sent = signal_original(signal.SIGTERM)
            term_attempted = sent is not None
            term_sent = sent is True
        if time.monotonic() - stop_at >= grace_seconds and not kill_attempted:
            sent = signal_original(signal.SIGKILL)
            kill_attempted = sent is not None
            kill_sent = sent is True

    def pump(writing=False, discard=False):
        nonlocal closed, discarded_output
        tick()
        if discard or (kill_attempted and time.monotonic() - stop_at >= grace_seconds + 1.0):
            discarded_output += len(pending_output)
            pending_output.clear()
        # Keep output bounded and backpressured without a blocking inner write.
        # Every loop can still observe stop, child exit and the input deadline.
        readable, writable, _ = select.select(
            [] if closed or len(pending_output) >= 65536 else [master],
            ([master] if writing and not closed else []) + ([1] if pending_output else []),
            [], 0.1)
        if 1 in writable:
            try:
                count = os.write(1, pending_output)
                if not count:
                    raise BrokenPipeError("Original output pipe closed")
                del pending_output[:count]
            except BlockingIOError:
                pass
        if master in readable:
            try:
                chunk = os.read(master, 65536 if discard else 65536 - len(pending_output))
                if not chunk:
                    closed = True
                elif discard:
                    discarded_output += len(chunk)
                else:
                    pending_output.extend(chunk)
            except OSError as error:
                if error.errno == errno.EIO:
                    closed = True
                elif error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                    raise
        return master in writable and not closed

    def reap():
        nonlocal reaped_status
        if reaped_status is None:
            if not probe_child():
                raise RuntimeError("Original terminal child is not yet waitable")
            # waitid(WNOWAIT) above already proved exit; this cannot wait on a
            # live or recycled process.
            reaped_pid, reaped_status = os.waitpid(pid, os.WNOHANG)
            if reaped_pid != pid:
                raise RuntimeError("Original terminal child custody changed")
        return reaped_status

    def result_record(error=None):
        status = reap()
        result = {"schema": "stellar-forge.application-terminal-exit.v1", "completedAt": now(),
                  "operationId": root.name, "pid": pid, "stopped": stopping,
                  "exitCode": os.waitstatus_to_exitcode(status),
                  "termination": {"reason": stop_reason, "graceSeconds": grace_seconds,
                                  "termSent": term_sent, "killSent": kill_sent,
                                  "processStart": original_start, "group": pid, "session": pid},
                  "discardedOutputBytes": discarded_output}
        if error is not None:
            result["bridgeError"] = str(error)[:2000]
        save(root / "terminal-exit.json", result)
        return result

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        # Await the same unreaped child, never a replacement launch. The pipe
        # has one writer created by this pty.fork and closes before exec.
        deadline = time.monotonic() + 5.0
        received = bytearray()
        announced = None
        while original_start is None:
            if stopping or probe_child():
                raise RuntimeError("Original terminal ended before its identity handoff")
            if time.monotonic() >= deadline:
                raise RuntimeError("Original terminal process identity unavailable")
            if announced is None:
                readable, _, _ = select.select([identity_reader], [], [], 0.05)
                if not readable:
                    continue
                chunk = os.read(identity_reader, 4097 - len(received))
                if not chunk:
                    raise RuntimeError("Original terminal identity handoff closed")
                received.extend(chunk)
                if len(received) > 4096:
                    raise RuntimeError("Original terminal identity handoff exceeded its bound")
                if b"\n" not in received:
                    continue
                announced = json.loads(received)
                if (announced.get("pid") != pid or announced.get("parent") != os.getpid()
                        or announced.get("group") != pid or announced.get("session") != pid
                        or not isinstance(announced.get("procPid"), int)
                        or not isinstance(announced.get("processStart"), str)):
                    raise RuntimeError("Original terminal identity handoff changed")
                _process_paths[pid] = announced["procPid"]
            observed = process_identity(pid)
            if observed is None:
                select.select([], [], [], 0.05)
                continue
            if (observed["processStart"] != announced["processStart"]
                    or observed["group"] != pid or observed["session"] != pid
                    or observed["pidNamespace"] != announced["pidNamespace"]):
                raise RuntimeError("Original terminal process identity changed")
            original = observed
            original_start = observed["processStart"]
        save(root / "terminal-process.json", {
            "schema": "stellar-forge.application-terminal-process.v1",
            "startedAt": now(), "operationId": root.name,
            "bridge": {"pid": os.getpid(), "processStart": identity(os.getpid())},
            "original": {"pid": pid, "processStart": original_start, "group": pid, "session": pid,
                         "procPid": original["procPid"], "procGroup": original["procGroup"],
                         "procSession": original["procSession"], "pidNamespace": original["pidNamespace"],
                         "executable": executable, "args": argv, "cwd": launch["cwd"]},
            "terminal": os.ttyname(master), "inputMode": "explicit-operator",
        })
        while not closed or not waitable or pending_output:
            pump()
            if waitable and not closed:
                request_stop("original_child_exited")
            if stop_at is not None or waitable:
                continue
            for pending in sorted((root / "terminal-pending").glob("*.json")):
                if stopping or probe_child():
                    break
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
                deadline = time.monotonic() + input_seconds
                try:
                    while count < len(data):
                        if stopping or probe_child():
                            raise InterruptedError("Original terminal stopped during input")
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Original terminal did not accept the complete input within 10 seconds")
                        if not pump(writing=True):
                            if closed:
                                raise BrokenPipeError("Original terminal closed during input")
                            continue
                        if stopping or probe_child():
                            raise InterruptedError("Original terminal stopped during input")
                        try:
                            written = os.write(master, data[count:])
                            if not written:
                                raise BrokenPipeError("Original terminal did not accept input")
                            count += written
                        except BlockingIOError:
                            continue
                    receipt.update(state="SENT", sentAt=now(), writtenBytes=count)
                except OSError as error:
                    receipt.update(state="DELIVERY_UNCERTAIN", writtenBytes=count,
                                   error=str(error)[:2000], completedAt=now())
                save(receipt_path, receipt)
                pending.unlink()
                if stopping or waitable:
                    break
        result = result_record()
        code = result["exitCode"]
        return code if code >= 0 else 128 - code
    except BaseException as error:
        request_stop("bridge_failure", explicit=True)
        # The original lease remains held during graceful shutdown, identity-
        # checked escalation, PTY drain and reap. No blocking wait on a live
        # child follows a single TERM, and no input packet is dispatched here.
        while not closed or not waitable or pending_output:
            try:
                pump(discard=True)
            except OSError:
                closed = True
                tick()
                select.select([], [], [], 0.1)
            if waitable and closed and not pending_output:
                break
        try:
            result_record(error)
        except OSError:
            pass
        raise
    finally:
        os.close(identity_reader)
        os.close(master)

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--operation":
        raise SystemExit("Use the original managed command runner")
    raise SystemExit(main(sys.argv[2]))
