#!/usr/bin/env python3
"""MIT. Execute one original installed ODK managed receiving with an OS-owned lock."""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
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
    # The same receiving host can reuse a PID after an interrupted invocation.
    # Keep each unpublished temporary unique while preserving the original target.
    fd, temporary_name = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    temporary = Path(temporary_name)
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

class OriginalClosureError(RuntimeError):
    def __init__(self, message, remaining=None):
        super().__init__(message)
        self.remaining = remaining


def enable_native_custody():
    """The existing Linux launcher owns adopted children, including detached browsers."""
    if not sys.platform.startswith("linux") or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("Use the original Linux host with Python 3.11+, procfs and pidfd process signalling.")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, this process only.
        raise OSError(ctypes.get_errno(), "Cannot retain the original native child custody.")
    enabled = ctypes.c_int()
    if libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise RuntimeError("The original native child custody was not enabled.")
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def stable_host_identity():
    """Keep native machine identities private; boot IDs alone do not identify a host."""
    def token(paths):
        for filename in paths:
            try:
                value = Path(filename).read_text().strip().lower().replace("-", "")
            except OSError:
                continue
            if (len(value) == 32 and all(char in "0123456789abcdef" for char in value)
                    and value not in ("0" * 32, "f" * 32)):
                return value
        return None

    machine = token(("/etc/machine-id", "/var/lib/dbus/machine-id"))
    product = token(("/sys/class/dmi/id/product_uuid",))
    def digest_identity(kind, value):
        return hashlib.sha256((kind + "\0" + value).encode()).hexdigest() if value else None
    return {"schema": "linux-stable-host-identity.v1",
            "machineIdSha256": digest_identity("linux-machine-id.v1", machine),
            "dmiProductUuidSha256": digest_identity("linux-dmi-product-uuid.v1", product)}


def same_stable_host(original, current):
    if not isinstance(original, dict) or not isinstance(current, dict):
        return False
    if original.get("schema") != "linux-stable-host-identity.v1" or original != current:
        return False
    values = [original.get("machineIdSha256"), original.get("dmiProductUuidSha256")]
    return (any(value is not None for value in values) and
            all(value is None or (isinstance(value, str) and len(value) == 64 and
                all(char in "0123456789abcdef" for char in value)) for value in values))


def proc_status(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key] = value.strip()
    return values


def proc_view():
    cached = getattr(proc_view, "_retained", None)
    if cached is not None:
        return cached
    raw = Path("/proc/self/stat").read_text()
    visible_pid = int(raw.split("(", 1)[0].strip())
    status = proc_status("/proc/self/status")
    namespace_pids = [int(value) for value in status.get("NSpid", "").split()]
    if not namespace_pids:
        if visible_pid != os.getpid():
            raise OriginalClosureError("The proc mount does not expose the original caller PID mapping.")
        namespace_pids = [visible_pid]
    if namespace_pids[0] != visible_pid or namespace_pids[-1] != os.getpid():
        raise OriginalClosureError("The original caller's proc and syscall PID identities disagree.")
    # This process's final column identifies the caller namespace. A descendant
    # may have additional columns; its final column is not our syscall PID.
    cached = {"pid": os.getpid(), "procPid": visible_pid,
              "namespaceColumn": len(namespace_pids) - 1,
              "pidNamespace": os.readlink("/proc/self/ns/pid"),
              "childrenPath": "/proc/thread-self/children"}
    proc_view._retained = cached
    return cached


def proc_identity(proc_pid, boot_id, view):
    try:
        directory = Path("/proc") / str(proc_pid)
        raw = (directory / "stat").read_text()
        fields = raw[raw.rfind(")") + 2:].split()
        if len(fields) < 20 or int(raw.split("(", 1)[0].strip()) != proc_pid:
            raise OriginalClosureError("The original mounted-proc identity is incomplete.")
        status = proc_status(directory / "status")
        namespace_pids = [int(value) for value in status.get("NSpid", "").split()]
        if not namespace_pids and view["namespaceColumn"] == 0:
            namespace_pids = [proc_pid]
        column = view["namespaceColumn"]
        if (len(namespace_pids) <= column or namespace_pids[0] != proc_pid or
                namespace_pids[column] <= 0):
            raise OriginalClosureError("The original child has no PID in the caller namespace.")
        try:
            namespace = os.readlink(directory / "ns" / "pid")
        except FileNotFoundError:
            namespace = None
        again = (directory / "stat").read_text()
        current = again[again.rfind(")") + 2:].split()
        if len(current) < 20 or current[19] != fields[19]:
            return None
        if namespace is None and current[0] not in ("Z", "X"):
            raise OriginalClosureError("The original live child namespace cannot be observed.")
    except FileNotFoundError:
        return None
    parent_proc_pid = int(fields[1])
    def caller_value(name, fallback):
        values = [int(value) for value in status.get(name, "").split()]
        return values[column] if len(values) > column else fallback if column == 0 else None
    return {"pid": namespace_pids[column], "procPid": proc_pid,
            "parentPid": (view["pid"] if parent_proc_pid == view["procPid"] else
                          os.getppid() if proc_pid == view["procPid"] else None),
            "parentProcPid": parent_proc_pid,
            "processGroup": caller_value("NSpgid", int(fields[2])),
            "session": caller_value("NSsid", int(fields[3])),
            "procProcessGroup": int(fields[2]), "procSession": int(fields[3]),
            "pidNamespace": namespace, "namespaceColumn": column,
            "state": current[0], "startTicks": fields[19], "bootId": boot_id}


def direct_child_proc_pids(view):
    """Find only this actual parent's children; no command or resource census."""
    if view.get("childrenMode") != "parent-stat":
        try:
            values = [int(value) for value in Path(view["childrenPath"]).read_text().split()]
            view["childrenMode"] = "children-file"
            return values
        except FileNotFoundError:
            # Some hosts omit the task-children interface.
            # The original parent identity still supports an ownership lookup.
            view["childrenMode"] = "parent-stat"
    children = []
    with os.scandir("/proc") as entries:
        for entry in entries:
            if not entry.name.isascii() or not entry.name.isdecimal():
                continue
            try:
                value = (Path("/proc") / entry.name / "stat").read_text()
            except (FileNotFoundError, ProcessLookupError):
                continue
            fields = value[value.rfind(")") + 2:].split()
            if len(fields) < 20 or int(value.split("(", 1)[0].strip()) != int(entry.name):
                raise OriginalClosureError("The process-parent ownership lookup was incomplete.")
            if int(fields[1]) == view["procPid"]:
                children.append(int(entry.name))
    return children


def pidfd_proc_pid(pid, view):
    """Use the original syscall identity to read its proc-view PID when exposed."""
    try:
        descriptor = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        return None
    try:
        try:
            info = proc_status(Path("/proc/self/fdinfo") / str(descriptor))
        except (FileNotFoundError, ProcessLookupError):
            return None
        value = info.get("Pid")
        if value is None:
            return None
        proc_pid = int(value)
        if proc_pid <= 0:
            return None
        pids = [int(value) for value in info.get("NSpid", "").split()]
        if pids and (len(pids) <= view["namespaceColumn"] or pids[0] != proc_pid or
                     pids[view["namespaceColumn"]] != pid):
            return None
        return proc_pid
    finally:
        os.close(descriptor)


def process_identity(pid, boot_id, proc_pid=None):
    view = proc_view()
    if proc_pid is not None:
        candidates = [proc_pid]
    elif pid == view["pid"]:
        candidates = [view["procPid"]]
    else:
        mapped = pidfd_proc_pid(pid, view)
        if mapped is not None:
            identity = proc_identity(mapped, boot_id, view)
            if identity is not None and identity["pid"] == pid:
                return identity
        candidates = direct_child_proc_pids(view)
        if view["namespaceColumn"] == 0 and pid not in candidates:
            candidates.append(pid)
    for candidate in candidates:
        identity = proc_identity(candidate, boot_id, view)
        if identity is not None and identity["pid"] == pid:
            return identity
    return None


def owned_children(boot_id):
    """Use this thread's kernel-owned list, mapped into the caller's PID namespace."""
    view = proc_view()
    children = []
    for value in direct_child_proc_pids(view):
        identity = proc_identity(value, boot_id, view)
        if identity is not None and identity["parentProcPid"] == view["procPid"]:
            children.append(identity)
    return children


def observe_original(child):
    # WNOWAIT keeps this exact child unreaped, so its PID cannot be reassigned.
    observed = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    if observed is None:
        return None
    return observed.si_status if observed.si_code == os.CLD_EXITED else -observed.si_status


def wait_original(child, timeout):
    deadline = time.monotonic() + timeout
    while True:
        code = observe_original(child)
        if code is not None:
            return code
        if time.monotonic() >= deadline:
            raise subprocess.TimeoutExpired(child.args, timeout)
        time.sleep(0.1)


def signal_owned_child(identity, signum, boot_id):
    """Pin an actual current child before signalling; PID reuse cannot retarget it."""
    if identity.get("bootId") != boot_id:
        return
    try:
        descriptor = os.pidfd_open(identity["pid"], 0)
    except ProcessLookupError:
        return
    try:
        current = process_identity(identity["pid"], boot_id, proc_pid=identity.get("procPid"))
        if (current is None or current["parentPid"] != os.getpid() or
                current["procPid"] != identity.get("procPid", current["procPid"]) or
                current["startTicks"] != identity["startTicks"]):
            return
        try:
            signal.pidfd_send_signal(descriptor, signum, None, 0)
        except ProcessLookupError:
            pass
    finally:
        os.close(descriptor)


def reap_finished_descendants(child, boot_id):
    for identity in owned_children(boot_id):
        if identity["pid"] != child.pid and identity["state"] in ("Z", "X"):
            try:
                os.waitpid(identity["pid"], os.WNOHANG)
            except ChildProcessError:
                pass


def live_owned_children(child, boot_id):
    reap_finished_descendants(child, boot_id)
    return [identity for identity in owned_children(boot_id) if identity["state"] not in ("Z", "X")]


def stop_original(child, boot_id):
    retained = getattr(child, "_original_closed", None)
    if retained is not None:
        return retained
    if child.returncode is not None:
        raise OriginalClosureError("The original leader was reaped before its native child custody closed.")
    # First let the original Node driver close its application and Playwright itself.
    if observe_original(child) is None:
        identity = process_identity(child.pid, boot_id)
        if identity is not None:
            signal_owned_child(identity, signal.SIGTERM, boot_id)
        deadline = time.monotonic() + 55
        while observe_original(child) is None and time.monotonic() < deadline:
            time.sleep(0.1)
    # An abnormal Node exit reparents even detached/session-owning browsers here.
    # Their kernel parent plus pidfd, not a process-name/PID scan, owns every signal.
    for signum, seconds in ((signal.SIGTERM, 5), (signal.SIGKILL, 10)):
        deadline = time.monotonic() + seconds
        while True:
            remaining = live_owned_children(child, boot_id)
            if not remaining:
                break
            for identity in remaining:
                signal_owned_child(identity, signum, boot_id)
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
        if not live_owned_children(child, boot_id):
            break
    remaining = live_owned_children(child, boot_id)
    if remaining:
        raise OriginalClosureError("The original native children are still closing.", remaining)
    reap_finished_descendants(child, boot_id)
    # Reap the reserved leader only after every admitted descendant has exited.
    code = child.wait(timeout=1)
    remaining = owned_children(boot_id)
    if remaining:
        raise OriginalClosureError("The original native child custody is not empty.", remaining)
    result = {"exitCode": code, "closed": True, "custody": "linux-subreaper-pidfd-v1",
              "remainingChildren": []}
    child._original_closed = result
    return result


def reconcile_previous_closure(private, boot_id, host_identity):
    """Preserve an incomplete native custody result instead of relaunching over it."""
    result_path = private / "launch-result.json"
    if not result_path.exists():
        return
    original_bytes = result_path.read_bytes()
    result = json.loads(original_bytes)
    if result.get("operationId") != OPERATION:
        raise ValueError("Use the original matching native receiving result.")
    if result.get("closed") is True:
        if (result.get("closureReason") == "original-host-reboot" and
                not same_stable_host(result.get("hostIdentity"),
                                     (result.get("closureObservation") or {}).get("hostIdentity"))):
            raise OriginalClosureError(
                "The retained reboot closure has no matching original host identity. "
                "Reconcile its original host evidence before another start.")
        return
    previous_boot = (result.get("parentIdentity") or {}).get("bootId")
    if isinstance(previous_boot, str) and previous_boot and previous_boot != boot_id:
        if not same_stable_host(result.get("hostIdentity"), host_identity):
            # A copied or mounted directory can come from another still-running
            # host. Preserve its exact result; this kernel cannot close that launch.
            raise OriginalClosureError(
                "The kernel boot changed without a matching retained native host identity. "
                "Continue reconciliation on the original host; the original result is preserved.")
        prior_sha256 = hashlib.sha256(original_bytes).hexdigest()
        closure_key = hashlib.sha256(original_bytes + b"\0" + boot_id.encode()).hexdigest()
        closure_path = private / ("launch-closure-" + closure_key + ".json")
        observation = {"originalBootId": previous_boot, "currentBootId": boot_id,
                       "hostIdentity": host_identity}
        if closure_path.exists():
            closed = json.loads(closure_path.read_bytes())
            if (closed.get("operationId") != OPERATION or closed.get("closed") is not True or
                    closed.get("closureReason") != "original-host-reboot" or
                    closed.get("reconciledFromSha256") != prior_sha256 or
                    closed.get("closureObservation") != observation):
                raise ValueError("The retained original reboot closure has changed.")
            result = closed
        else:
            result["priorClosure"] = {"state": result.get("state"),
                                      "remainingChildren": result.get("remainingChildren"),
                                      "cleanupError": result.get("cleanupError")}
            result.update({"closed": True, "state": "CLOSED", "remainingChildren": [],
                           "closureReason": "original-host-reboot", "closureReconciledAt": time.time(),
                           "closureObservation": observation, "reconciledFromSha256": prior_sha256})
            # Retain this closure before a later launch replaces launch-result.json.
            # Reuse its first observed timestamp after an interrupted publication.
            write_json(closure_path, result)
        write_json(result_path, result)
        return
    observed = []
    for identity in result.get("remainingChildren") or []:
        if identity.get("bootId") != boot_id:
            continue
        current = process_identity(identity["pid"], boot_id, proc_pid=identity.get("procPid"))
        if current is not None and current["startTicks"] == identity.get("startTicks"):
            observed.append(current)
    result["closureObservation"] = {"observedAt": time.time(), "originalIdentities": observed}
    write_json(result_path, result)
    # Loss of the parent can also lose the complete descendant set. A later empty
    # PID observation cannot prove that original detached children were closed.
    raise OriginalClosureError(
        "The original native custody has no complete closure. Reconcile its retained launch-owner, "
        "launch-result and native operation on the same host before another start.", observed)


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
    summary = None
    boot_id = None
    host_identity = None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("Keep the original private lock file.")
        boot_id = enable_native_custody()
        host_identity = stable_host_identity()
        reconcile_previous_closure(private, boot_id, host_identity)
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
        owner = {"operationId": OPERATION, "pid": os.getpid(), "startedAt": time.time(), "selection": selection,
                 "custody": "linux-subreaper-pidfd-v1", "parentIdentity": process_identity(os.getpid(), boot_id),
                 "hostIdentity": host_identity,
                 "launchIdentity": str(os.getpid()) + ":" + str(time.time_ns())}
        os.ftruncate(lock, 0)
        os.write(lock, (json.dumps(owner) + "\n").encode())
        os.fsync(lock)
        interruption = {"deferred": False, "pending": None}
        def interrupted(signum, _frame):
            if interruption["deferred"]:
                if interruption["pending"] is None:
                    interruption["pending"] = signum
                return
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
            # Keep handled cancellation pending until Popen has assigned this exact
            # child and its owner/result are durable; the child inherits no new mask.
            interruption["deferred"] = True
            try:
                # Retain this dispatch before a child can start; an old successful result
                # must never stand in for an unobserved later launch.
                write_json(private / "launch-owner.json", owner)
                disposition = {"operationId": OPERATION, "launchIdentity": owner["launchIdentity"],
                               "parentIdentity": owner["parentIdentity"], "hostIdentity": host_identity,
                               "state": "DISPATCHING",
                               "closed": False, "remainingChildren": None}
                write_json(private / "launch-result.json", disposition)
                try:
                    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                             env=environment, start_new_session=True)
                except OSError:
                    disposition.update({"state": "NOT_STARTED", "closed": True, "remainingChildren": []})
                    write_json(private / "launch-result.json", disposition)
                    raise
                owner["childPid"] = child.pid
                owner["childIdentity"] = process_identity(child.pid, boot_id)
                write_json(private / "launch-owner.json", owner)
                disposition.update({"childPid": child.pid, "childIdentity": owner["childIdentity"], "state": "RUNNING"})
                write_json(private / "launch-result.json", disposition)
            finally:
                interruption["deferred"] = False
                if interruption["pending"] is not None and sys.exc_info()[0] is None:
                    raise KeyboardInterrupt("Original receiving stopped by signal " + str(interruption["pending"]))
            code = wait_original(child, args.timeout_seconds)
        disposition.update({"operationId": OPERATION, "childPid": child.pid, "exitCode": code, "closed": False})
        if code:
            raise RuntimeError("Original managed receiving exited " + str(code) + ". Read its retained stderr and operation.json.")
        result_path = root / "delivery" / "managed-receiving.json"
        result = json.loads(result_path.read_text())
        if result.get("status") != "COMPLETE" or result.get("operationId") != OPERATION:
            raise ValueError("The original programme has no complete matching result.")
        summary = {"operationId": OPERATION, "status": result["status"], "result": str(result_path),
                   "resultSha256": hashlib.sha256(result_path.read_bytes()).hexdigest(),
                   "workspaceId": result["originalWorkspaceId"], "archive": result["archive"],
                   "exitCode": code}
    finally:
        # Do not allow a second cancellation to skip closure of this exact child.
        for signum in original_handlers:
            signal.signal(signum, signal.SIG_IGN)
        primary = sys.exc_info()[1]
        cleanup_error = None
        try:
            if child is not None:
                closure = stop_original(child, boot_id)
                disposition.update({"operationId": OPERATION, "childPid": child.pid, "state": "CLOSED", **closure})
                write_json(private / "launch-result.json", disposition)
        except Exception as error:
            cleanup_error = error
            if child is not None:
                disposition.update({"operationId": OPERATION, "childPid": child.pid, "closed": False,
                                    "custody": "linux-subreaper-pidfd-v1", "state": "CLOSURE_UNRESOLVED",
                                    "remainingChildren": getattr(error, "remaining", None),
                                    "cleanupError": {"type": type(error).__name__, "message": str(error)}})
                try:
                    write_json(private / "launch-result.json", disposition)
                except Exception as save_error:
                    print(json.dumps({"operationId": OPERATION, "closureSaveError": str(save_error)}), file=sys.stderr)
        finally:
            for signum, handler in original_handlers.items():
                signal.signal(signum, handler)
            os.close(lock)
        if cleanup_error is not None:
            if primary is None:
                raise cleanup_error
            print(json.dumps({"operationId": OPERATION, "cleanupError": {
                "type": type(cleanup_error).__name__, "message": str(cleanup_error)}}), file=sys.stderr)

    if summary is not None:
        print(json.dumps(summary))

if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"operationId": OPERATION, "status": "INTERRUPTED",
                          "error": {"type": type(error).__name__, "message": str(error)}}), file=sys.stderr)
        sys.exit(1)
