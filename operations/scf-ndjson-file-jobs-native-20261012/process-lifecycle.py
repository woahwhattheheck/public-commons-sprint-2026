# MIT. Observe the original merchant native-process owner on Linux.
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

SCHEMA = "stellar-forge.ndjson-process-lifecycle.v1"
HERE = Path(__file__).resolve().parent
HOST_FILES = [
    "stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/processes-host.mjs",
    "stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/process-supervisor.mjs",
]


def require(value, message):
    if not value:
        raise RuntimeError(message)


def save(path, value):
    temporary = path.with_name(path.name + ".next")
    with temporary.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write("\n")
        output.flush()
    os.replace(temporary, path)


def event(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def identity(pid):
    try:
        text = Path("/proc", str(pid), "stat").read_text()
    except (FileNotFoundError, ProcessLookupError):
        return None
    fields = text[text.rfind(")") + 2:].split()
    return {"pid": int(pid), "parent": int(fields[1]), "group": int(fields[2]),
            "session": int(fields[3]), "startTicks": fields[19], "state": fields[0]}


def same_process(expected, observed):
    return observed is not None and expected["pid"] == observed["pid"] and \
        expected["startTicks"] == observed["startTicks"]


def group_members(group):
    result = []
    for name in os.listdir("/proc"):
        if name.isdecimal():
            try:
                observed = identity(int(name))
            except PermissionError:
                continue
            if observed is not None and observed["group"] == group:
                result.append(observed)
    return sorted(result, key=lambda item: item["pid"])


def source_identity(source):
    result = []
    for relative in HOST_FILES:
        content = (source / relative).read_bytes()
        result.append({"path": relative, "bytes": len(content),
                       "sha256": hashlib.sha256(content).hexdigest(),
                       "gitBlob": hashlib.sha1(b"blob " + str(len(content)).encode() +
                                               b"\0" + content).hexdigest()})
    return result


class Owner:
    def __init__(self, node, source, case, mode):
        self.case = case
        self.mode = mode
        self.events = []
        self.consumed = 0
        self.logs = {"stdout": bytearray(), "stderr": bytearray()}
        self.lines = bytearray()
        self.reaped = []
        self.ready = None
        self.tracked = []
        self.private = None
        self.group = None
        self.cleanup = []
        self.select = selectors.DefaultSelector()
        temporary = case / "temporary"
        temporary.mkdir(mode=0o700)
        self.process = subprocess.Popen(
            [node, str(HERE / "process-lifecycle-owner.mjs"), "owner",
             str(source), str(temporary), mode],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=str(case), bufsize=0,
        )
        self.merchant = identity(self.process.pid)
        require(self.merchant is not None, "The original owner exited before observation")
        self.tracked.append(self.merchant)
        for name in ("stdout", "stderr"):
            stream = getattr(self.process, name)
            os.set_blocking(stream.fileno(), False)
            self.select.register(stream, selectors.EVENT_READ, name)

    def reap(self):
        # Only descendants of this private observer can be adopted here.
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                break
            if pid == 0:
                break
            code = os.waitstatus_to_exitcode(status)
            self.reaped.append({"pid": pid, "returnCode": code})
            if pid == self.process.pid:
                self.process.returncode = code

    def pump(self, seconds=0.05):
        self.reap()
        for key, _ in self.select.select(seconds):
            try:
                chunk = os.read(key.fileobj.fileno(), 65536)
            except BlockingIOError:
                continue
            if not chunk:
                self.select.unregister(key.fileobj)
                continue
            name = key.data
            self.logs[name].extend(chunk)
            require(len(self.logs[name]) <= 1048576, "The original owner log exceeded one MiB")
            if name == "stdout":
                self.lines.extend(chunk)
                while b"\n" in self.lines:
                    line, _, rest = self.lines.partition(b"\n")
                    self.lines = bytearray(rest)
                    if not line:
                        continue
                    value = json.loads(line)
                    require(isinstance(value, dict), "The owner returned an invalid operation event")
                    self.events.append(value)
        self.reap()

    def take(self, wanted, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            while self.consumed < len(self.events):
                value = self.events[self.consumed]
                self.consumed += 1
                if value.get("type") == "failure":
                    raise RuntimeError("Original native owner failed: " +
                                       value.get("error", {}).get("message", "unknown error"))
                if value.get("type") == wanted:
                    return value
            self.pump()
            if self.process.returncode is not None and not self.select.get_map():
                raise RuntimeError("The owner exited before " + wanted +
                                   ": " + str(self.process.returncode))
        raise TimeoutError("Timed out awaiting original owner event " + wanted)

    def send(self, action):
        self.process.stdin.write((json.dumps({"action": action}) + "\n").encode())
        self.process.stdin.flush()

    def signal_merchant(self, selected_signal):
        require(same_process(self.merchant, identity(self.merchant["pid"])),
                "The selected merchant process has already changed")
        if hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"):
            descriptor = os.pidfd_open(self.merchant["pid"])
            try:
                require(same_process(self.merchant, identity(self.merchant["pid"])),
                        "The selected merchant process changed during signal selection")
                signal.pidfd_send_signal(descriptor, selected_signal)
            finally:
                os.close(descriptor)
        else:
            os.kill(self.merchant["pid"], selected_signal)

    def wait_exit(self, timeout=10):
        deadline = time.monotonic() + timeout
        while self.process.returncode is None and time.monotonic() < deadline:
            self.pump()
        require(self.process.returncode is not None, "The original owner did not exit")
        self.pump(0)
        return self.process.returncode

    def observation(self, tracked=None, directory_absent=True):
        self.reap()
        selected = self.tracked if tracked is None else tracked
        remaining = []
        for original in selected:
            current = identity(original["pid"])
            if same_process(original, current):
                remaining.append(current)
        members = group_members(self.group)
        exists = os.path.lexists(self.private)
        return {"trackedProcessesRemaining": remaining, "processGroupMembers": members,
                "privateDirectoryExists": exists,
                "retired": not remaining and not members and
                (not exists if directory_absent else exists)}

    def wait_retired(self, tracked=None, directory_absent=True, timeout=10):
        deadline = time.monotonic() + timeout
        latest = None
        while time.monotonic() < deadline:
            self.pump()
            latest = self.observation(tracked, directory_absent)
            if latest["retired"]:
                return latest
        raise RuntimeError("The original owner did not retire its selected resources: " +
                           json.dumps(latest, separators=(",", ":")))

    def finish(self, failed):
        if failed:
            # Capture the failure before independently cleaning this owned fixture.
            if self.private and self.group:
                save(self.case / "before-emergency-cleanup.json", self.observation())
            if same_process(self.merchant, identity(self.merchant["pid"])):
                try:
                    self.send("close")
                    self.cleanup.append("Requested original host.close")
                    self.wait_exit(2)
                except Exception:
                    if same_process(self.merchant, identity(self.merchant["pid"])):
                        self.signal_merchant(signal.SIGKILL)
                        self.cleanup.append("Killed this original fixture owner")
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                self.pump()
            if self.group:
                owned = [row for row in self.tracked
                         if same_process(row, identity(row["pid"])) and row["group"] == self.group]
                if owned:
                    try:
                        os.killpg(self.group, signal.SIGKILL)
                        self.cleanup.append("Killed the still-owned fixture process group")
                    except ProcessLookupError:
                        pass
            for original in self.tracked:
                if same_process(original, identity(original["pid"])):
                    try:
                        os.kill(original["pid"], signal.SIGKILL)
                        self.cleanup.append("Killed remaining owned fixture PID " + str(original["pid"]))
                    except ProcessLookupError:
                        pass
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                self.pump()
            if self.private and os.path.lexists(self.private):
                parent = (self.case / "temporary").resolve()
                selected = Path(self.private)
                require(selected.parent == parent and selected.name.startswith("starforge-job-"),
                        "The fixture directory identity changed before cleanup")
                shutil.rmtree(selected)
                self.cleanup.append("Removed the failed fixture's owned private directory")
        self.reap()
        self.select.close()
        for name, content in self.logs.items():
            (self.case / ("merchant-" + name + ".log")).write_bytes(content)
        save(self.case / "owner-events.json", self.events)
        save(self.case / "reaped-processes.json", self.reaped)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()


def run_case(node, source, output, mode):
    case = output / mode
    case.mkdir(mode=0o700)
    owner = Owner(node, source, case, mode)
    result = {"case": mode, "state": "RUNNING", "startedAt": time.time()}
    failed = True
    try:
        ready = owner.take("ready")
        owner.ready = ready
        owner.private = ready["directory"]
        require(Path(owner.private).parent == (case / "temporary").resolve() and
                Path(owner.private).name.startswith("starforge-job-"),
                "The original host selected another private directory")
        require(stat.S_IMODE(os.lstat(owner.private).st_mode) == 0o700,
                "The original host directory is not private")
        require(same_process(owner.merchant, ready["merchant"]),
                "The operation event belongs to another merchant owner")
        child, grandchild, guardian = ready["child"], ready["grandchild"], ready["guardian"]
        owner.group = child["group"]
        require(owner.group == child["pid"] and child["session"] == child["pid"] and
                grandchild["group"] == owner.group and grandchild["parent"] == child["pid"] and
                child["parent"] == guardian["pid"],
                "The original detached child and grandchild do not share their owned process group")
        require(same_process(guardian, identity(guardian["pid"])),
                "The original persistent process supervisor is missing")
        owner.tracked.extend([guardian, child, grandchild])
        save(case / "ready.json", ready)
        event({"case": mode, "phase": "ORIGINAL_PROCESS_GROUP_READY",
               "merchant": owner.merchant["pid"], "group": owner.group})
        if mode == "merchant-kill-idle":
            require(ready["run"]["ok"] and ready["run"]["exitCode"] == 0,
                    "The original native operation did not complete before merchant death")
            result["afterNativeResult"] = owner.wait_retired(
                tracked=[child, grandchild], directory_absent=False)
            require(same_process(guardian, identity(guardian["pid"])),
                    "The idle native directory lost its persistent owner")
        else:
            require(same_process(child, identity(child["pid"])) and
                    same_process(grandchild, identity(grandchild["pid"])),
                    "The active native fixture ended before cancellation")
        if mode == "host-close":
            owner.send("close")
            closed = owner.take("closed", timeout=10)
            require(closed["run"].get("error", {}).get("code") == "JOB_NATIVE_PROCESS_INTERRUPTED",
                    "Explicit close did not interrupt the original active native call")
            require(owner.wait_exit() == 0, "The explicit host-close owner failed")
            result["nativeCancellation"] = closed["run"]
        else:
            owner.signal_merchant(signal.SIGKILL)
            require(owner.wait_exit() == -signal.SIGKILL, "The original merchant was not killed")
            result["merchantSignal"] = "SIGKILL"
        result["retirement"] = owner.wait_retired()
        result.update(state="COMPLETE", completedAt=time.time(),
                      merchant=owner.merchant, guardian=guardian,
                      child=child, grandchild=grandchild, directory=owner.private)
        failed = False
        event({"case": mode, "phase": "OWNED_GROUP_AND_DIRECTORY_RETIRED"})
        return result
    except BaseException as error:
        result.update(state="FAILED", failedAt=time.time(),
                      error={"type": type(error).__name__, "message": str(error)})
        if owner.private and owner.group:
            result["retirement"] = owner.observation()
        raise
    finally:
        try:
            owner.finish(failed)
        finally:
            result["emergencyCleanup"] = owner.cleanup
            save(case / "outcome.json", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--source-commit")
    args = parser.parse_args()
    require(sys.platform == "linux", "This native process-group operation requires Linux")
    require(not args.source_commit or re.fullmatch(r"[0-9a-f]{40}", args.source_commit),
            "Select an exact source commit")
    os.umask(0o077)
    source, output = Path(args.source_root), Path(args.directory)
    require(source.is_absolute() and source.is_dir(), "Select the complete original source root")
    require(output.is_absolute() and output != Path("/"), "Select the private operation output")
    require(Path(args.node).is_absolute() and os.access(args.node, os.X_OK),
            "Select the actual Node executable")
    require(output.parent.is_dir() and output.parent.resolve() == output.parent,
            "The receiving parent must already be a real directory")
    output.mkdir(mode=0o700)
    # The observer receives and reaps exited descendants after merchant death.
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(36, 1, 0, 0, 0) == 0, "Linux child-adoption setup failed")
    result = {"schema": SCHEMA, "state": "RUNNING", "startedAt": time.time(),
              "sourceRoot": str(source), "sourceCommit": args.source_commit,
              "source": source_identity(source), "outputDirectory": str(output),
              "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
              "observerReapsExitedDescendants": True, "cases": []}
    save(output / "selection.json", {key: result[key] for key in
         ("schema", "sourceRoot", "sourceCommit", "source", "outputDirectory", "bootId")})
    def interrupted(signum, _frame):
        raise InterruptedError("The original lifecycle observer received signal " + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        for mode in ("host-close", "merchant-kill-active", "merchant-kill-idle"):
            result["cases"].append(run_case(args.node, source, output, mode))
        result.update(state="COMPLETE", completedAt=time.time())
    except BaseException as error:
        result.update(state="FAILED", failedAt=time.time(),
                      error={"type": type(error).__name__, "message": str(error)})
        for mode in ("host-close", "merchant-kill-active", "merchant-kill-idle"):
            path = output / mode / "outcome.json"
            if path.is_file() and not any(item["case"] == mode for item in result["cases"]):
                result["cases"].append(json.loads(path.read_text()))
    finally:
        save(output / "native-outcome.json", result)
    event({"schema": SCHEMA, "state": result["state"], "cases": len(result["cases"]),
           "outcome": str(output / "native-outcome.json")})
    return 0 if result["state"] == "COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
