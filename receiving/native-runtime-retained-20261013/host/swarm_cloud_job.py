#!/usr/bin/env python3
"""Retain a native cloud command's log, exit and selected output artifacts.

This is a process operator for an existing cloud worker, not a scheduler or task
claim store. Commands, credentials, source and publication keep their existing
roads. No command is selected or retried automatically.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
import errno
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


SCHEMA = "commons.native_cloud_command/v1"
# Explicit native capability: older start(SimpleNamespace(...)) ignored fields
# it did not know. Callers must inspect this before requesting admission.
MEMORY_ADMISSION_SCHEMA = "commons.native-cloud-memory/v1"
MEMORY_ADMISSION_RECLAIM_MODES = ("none", "clean-cache")
MEMORY_ADMISSION_STORAGE_MODES = ("included", "additional")
DISK_ADMISSION_SCHEMA = "commons.native-cloud-disk/v1"
CAPACITY_QUEUED_STATES = ("queued_memory", "queued_disk")
CAPACITY_RESUMABLE_STATES = (*CAPACITY_QUEUED_STATES, "launch_pending")
NATIVE_LAUNCH_LOCK_SCHEMA = "commons.native-launch-lock/v1"
_RUN_LOCK_CONTEXT = ContextVar("native_run_lock_descriptors", default=())
NATIVE_SUPERVISOR_LOCK_SCHEMA = "commons.native-supervisor-lock/v1"
_SUPERVISOR_LOCK_CONTEXT = ContextVar("native_supervisor_lock_descriptors", default=())
_SUPERVISOR_LOCK_ENV = "SWARM_NATIVE_SUPERVISOR_LOCK_FD"

TERMINAL = {"completed", "failed", "launch_failed"}
QUIESCENT = TERMINAL | {"finalization_pending"}
NATIVE_COMPLETION_SCHEMA = "commons.native-command-completion/v1"
NATIVE_ARTIFACT_SELECTION_SCHEMA = "commons.native-artifact-selection/v1"
NATIVE_ARTIFACT_RETENTION_SCHEMA = "commons.native-artifact-retention/v1"
NATIVE_ARTIFACT_CHECKPOINT_SCHEMA = "commons.native-artifact-checkpoint/v1"
NATIVE_ARTIFACT_DELIVERY_SCHEMA = "commons.native-artifact-delivery/v1"
# These are only children launched by this exact Python process. Keeping the
# Popen objects preserves kernel wait status and the original foreground owner.
_OWNED_SUPERVISORS = {}
# A caller may retain the original supervisor in its own foreground process.
# The callback runs under the existing record lock after intent persistence.
NATIVE_LAUNCH_SCHEMA = "commons.native-supervisor-launch/v1"
NATIVE_FINALIZER_SCHEMA = "commons.native-supervisor-finalizer/v1"
NATIVE_FINALIZER_FAILED_EXIT = 74
RUNTIME_HANDOFF_SCHEMA = "commons.native-runtime-handoff/v1"
CAPACITY_FAILURE_RECOVERY_SCHEMA = "commons.native-capacity-failure-recovery/v1"
RUNTIME_CONSUMERS_SCHEMA = "commons.native-runtime-use/v1"
RUNTIME_DECLARATION_AMENDMENT_SCHEMA = "commons.native-runtime-declaration-amendment/v1"
NATIVE_CAPACITY_SCHEMA = "commons.native-capacity-history/v1"
NATIVE_CONTROL_LIFETIME_SCHEMA = "commons.native-control-lifetime/v1"


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=".pending-", delete=False) as stream:
            pending = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        pending.replace(path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def space_exhausted(error):
    """Identify storage pressure that can clear without changing the operation."""
    return isinstance(error, OSError) and error.errno in {errno.ENOSPC, errno.EDQUOT}

def save_observation_result(path, value):
    """Report an optional write without changing the committed native state."""
    try:
        save_json(path, value)
        return {"persisted": True}
    except OSError as exc:
        return {"persisted": False, "error_type": type(exc).__name__,
                "errno": exc.errno, "error": exc.strerror}


def save_observation(path, value):
    """Persist optional status without interrupting the original command.

    Reservation commits, command identity and completion allocation continue
    to use save_json and must succeed before their dependent action.
    """
    return save_observation_result(path, value)["persisted"]



def runs_root(selected=None):
    selected = selected or os.environ.get("SWARM_NATIVE_JOBS_ROOT")
    if selected:
        return Path(selected).expanduser().resolve()
    return Path(os.environ.get("SWARM_STATE_ROOT", "/workspace/shared/swarm")).resolve() / "jobs/native"


def run_path(operation_id, records_root=None):
    if not operation_id or len(operation_id) > 512 or any(ord(c) < 32 for c in operation_id):
        raise ValueError("Supply a nonempty operation ID of at most 512 printable characters.")
    return runs_root(records_root) / hashlib.sha256(operation_id.encode("utf-8")).hexdigest()


@contextmanager
def run_lock(root, *, blocking=True):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(root / ".lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        token = _RUN_LOCK_CONTEXT.set((*_RUN_LOCK_CONTEXT.get(), (str(root.resolve()), stream.fileno())))
        try:
            yield
        finally:
            _RUN_LOCK_CONTEXT.reset(token)


def launch_lock_descriptor(root):
    """Duplicate the currently held original record lock for synchronous IPC.

    SCM_RIGHTS retains this same open-file description. Closing either copy
    does not release the original flock while the other launch owner holds it.
    """
    selected = str(Path(root).resolve())
    for path, descriptor in reversed(_RUN_LOCK_CONTEXT.get()):
        if path == selected:
            return os.dup(descriptor)
    raise ValueError("Native queued launch requires its original active run_lock")



def validate_supervisor_lock_descriptor(root, descriptor):
    """Keep the exact native lifetime lock; never substitute a reopened inode.

    Re-locking a received duplicate operates on the SAME open-file description.
    Callers close their own copy; LOCK_UN would release every inherited copy.
    """
    if type(descriptor) is not int or descriptor < 0:
        raise ValueError("Supply the original native supervisor lock descriptor")
    path = Path(root) / ".supervisor.lock"
    opened = os.fstat(descriptor)
    selected = path.stat(follow_symlinks=False)
    if (not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(selected.st_mode)
            or opened.st_nlink < 1
            or (opened.st_dev, opened.st_ino) != (selected.st_dev, selected.st_ino)):
        raise ValueError("The native supervisor lock path changed")
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    selected = path.stat(follow_symlinks=False)
    if (not stat.S_ISREG(selected.st_mode)
            or (opened.st_dev, opened.st_ino) != (selected.st_dev, selected.st_ino)):
        raise ValueError("The native supervisor lock path changed during acquisition")
    os.set_inheritable(descriptor, False)
    return {"schema": NATIVE_SUPERVISOR_LOCK_SCHEMA, "path": str(path),
            "device": opened.st_dev, "inode": opened.st_ino}


@contextmanager
def supervisor_lock(root, *, create=False, descriptor=None, reuse_current=False):
    """Hold the original inode through validation and the existing launch.

    A busy lifetime lock is an unchanged ownership observation, even when the
    current procfs view cannot see its holder. No resume state is written.
    reuse_current explicitly borrows a CLOEXEC duplicate of this same held
    open-file description; it never reopens or unlocks the current inode.
    """
    if descriptor is None and reuse_current:
        selected = str(Path(root).resolve())
        for path, held, _details in reversed(_SUPERVISOR_LOCK_CONTEXT.get()):
            if path == selected:
                validate_supervisor_lock_descriptor(root, held)
                descriptor = fcntl.fcntl(held, fcntl.F_DUPFD_CLOEXEC, 3)
                break
    if descriptor is None:
        flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
        if create:
            flags |= os.O_CREAT
        descriptor = os.open(Path(root) / ".supervisor.lock", flags, 0o600)
    token = None
    try:
        try:
            details = validate_supervisor_lock_descriptor(root, descriptor)
        except BlockingIOError:
            yield None
            return
        token = _SUPERVISOR_LOCK_CONTEXT.set((*_SUPERVISOR_LOCK_CONTEXT.get(),
            (str(Path(root).resolve()), descriptor, details)))
        yield descriptor
    finally:
        if token is not None:
            _SUPERVISOR_LOCK_CONTEXT.reset(token)
        # Closing this description does not unlock an inherited recipient copy.
        os.close(descriptor)


def supervisor_lock_descriptor(root):
    """Duplicate the actively held original lifetime lock for its next owner."""
    selected = str(Path(root).resolve())
    for path, descriptor, _details in reversed(_SUPERVISOR_LOCK_CONTEXT.get()):
        if path == selected:
            validate_supervisor_lock_descriptor(root, descriptor)
            return fcntl.fcntl(descriptor, fcntl.F_DUPFD_CLOEXEC, 3)
    raise ValueError("Native launch requires its original active supervisor_lock")


def supervisor_lock_details(root):
    selected = str(Path(root).resolve())
    for path, descriptor, details in reversed(_SUPERVISOR_LOCK_CONTEXT.get()):
        if path == selected:
            validate_supervisor_lock_descriptor(root, descriptor)
            return dict(details)
    raise ValueError("Native recovery requires its original active supervisor_lock")


def identity_at(proc_path):
    """Read a visible procfs identity, including nested PID namespaces.

    Some cloud shells have their own PID namespace but inherit the VM's /proc
    mount. In that environment os.getpid() is NOT a /proc directory name.
    """
    try:
        raw = (proc_path / "stat").read_text()
        fields = raw[raw.rfind(")") + 2:].split()
        if fields[0] in ("Z", "X"):
            return None
        status = {}
        for line in (proc_path / "status").read_text().splitlines():
            key, _, value = line.partition(":")
            if key in ("NSpid", "NSpgid"):
                status[key] = [int(part) for part in value.split()]
        proc_pid = int(raw.split(" ", 1)[0])
        try:
            namespace = os.readlink(proc_path / "ns/pid")
        except PermissionError:
            # A later container shell can read a retained process's stat/status
            # while its kernel forbids following the other namespace link.
            # Keep the kernel process identity; only direct cross-namespace
            # signalling needs a positively known namespace.
            namespace = None
        return {"pid": status.get("NSpid", [proc_pid])[-1], "proc_pid": proc_pid,
                "start_ticks": fields[19], "pgid": status.get("NSpgid", [int(fields[2])])[-1],
                "namespace": namespace,
                "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (OSError, ValueError, IndexError):
        return None


def process_identity(pid, *, direct_child=False):
    """Resolve a caller-local PID through this shell's possibly host-mounted procfs.

    A numeric /proc directory is a procfs-visible PID, not necessarily the PID
    returned by Popen. Nonself lookups require a positively matching namespace
    and NSpid. Callers retaining a new Popen child can additionally require its
    current procfs-visible parent; this does not infer an exit from a failed read.
    """
    current = identity_at(Path("/proc/self"))
    if pid == os.getpid():
        return None if direct_child else current
    if not current or current["namespace"] is None:
        return None

    def candidate_at(proc_path):
        try:
            before = (proc_path / "stat").read_text()
            before_fields = before[before.rfind(")") + 2:].split()
            if direct_child and int(before_fields[1]) != current["proc_pid"]:
                return None
            candidate = identity_at(proc_path)
            if not candidate or candidate["pid"] != pid:
                return None
            if candidate["namespace"] != current["namespace"]:
                return None
            after = (proc_path / "stat").read_text()
            after_fields = after[after.rfind(")") + 2:].split()
            if (int(before.split(" ", 1)[0]) != candidate["proc_pid"] or
                    int(after.split(" ", 1)[0]) != candidate["proc_pid"] or
                    before_fields[19] != candidate["start_ticks"] or
                    after_fields[19] != candidate["start_ticks"] or
                    after_fields[0] in ("Z", "X")):
                return None
            if direct_child and int(after_fields[1]) != current["proc_pid"]:
                return None
            return candidate
        except (OSError, ValueError, IndexError):
            return None

    # Preserve the cheap normal-procfs path. It is still checked in the caller's
    # namespace, so a foreign process at the same numeric path cannot match.
    proc_root = Path("/proc")
    candidate = candidate_at(proc_root / str(pid))
    if candidate:
        return candidate
    try:
        # Some inherited proc mounts omit task/*/children. Parent-filter the
        # visible stat entries before namespace reads when a Popen child is known.
        for entry in proc_root.iterdir():
            if entry.name.isdigit() and entry.name != str(pid):
                candidate = candidate_at(entry)
                if candidate:
                    return candidate
    except OSError:
        pass
    return None


def child_process_identity(pid):
    """Observe an owned direct child in this caller's PID namespace."""
    return process_identity(pid, direct_child=True)


def _same_process(left, right):
    return bool(left and right) and all(left.get(key) == right.get(key) for key in
        ("pid", "proc_pid", "start_ticks", "pgid", "boot_id"))


def _supervisor_launch_key(launch):
    original = {key: launch.get(key) for key in ("started_at", "attempt", "parent")}
    return hashlib.sha256(json.dumps(original, sort_keys=True,
        separators=(",", ":")).encode("utf-8")).hexdigest()


def _observe_supervisor_launch(root, launch):
    """Return this launch's actual parent-owned wait result, when available.

    A later process can read a retained exit but cannot invent wait status for
    an old supervisor. Each launch has its own record so a late original parent
    cannot overwrite an explicit successor's observation.
    """
    if not launch:
        return None
    key = _supervisor_launch_key(launch)
    path = root / "supervisor-exits" / (key + ".json")
    owned_key = (str(root.resolve()), key)
    owned = _OWNED_SUPERVISORS.get(owned_key)
    if owned is None:
        retained = read_json(path)
        return {**retained, "retained": True} if retained else None
    child = owned["child"]
    code = child.poll()
    original = owned["launch"]
    if code is None:
        return {"schema": "commons.native-supervisor-exit/v1", "launch_key": key,
                "launch_attempt": original["attempt"], "source": "launching_parent",
                "parent": original["parent"], "supervisor": original.get("supervisor"),
                "state": "running", "observed_at": now()}
    if owned.get("outcome") is None:
        signal_number = -code if code < 0 else None
        try:
            signal_name = signal.Signals(signal_number).name if signal_number else None
        except ValueError:
            signal_name = None
        observed = {"schema": "commons.native-supervisor-exit/v1", "launch_key": key,
                    "launch_attempt": original["attempt"], "source": "parent_waitpid",
                    "parent": original["parent"], "supervisor": original.get("supervisor"),
                    "state": "exited", "observed_at": now(), "exit_code": code,
                    "signal_number": signal_number, "signal": signal_name}
        owned["outcome"] = observed
    observed = owned["outcome"]
    persistence_error = None
    if not owned.get("persisted"):
        try:
            save_json(path, observed)
            owned["persisted"] = True
            _OWNED_SUPERVISORS.pop(owned_key, None)
        except OSError as exc:
            # The actual wait result remains in the returned native status and
            # stderr even when this same journal cannot accept another file.
            persistence_error = {"kind": type(exc).__name__, "errno": exc.errno}
            if not owned.get("reported"):
                try:
                    print(json.dumps({"supervisor_exit": observed,
                                      "persistence_error": persistence_error}),
                          file=sys.stderr, flush=True)
                    owned["reported"] = True
                except OSError:
                    pass
    return {**observed, "retained": bool(owned.get("persisted")),
            **({"persistence_error": persistence_error} if persistence_error else {})}


def observe_supervisor(root, launch):
    """Retain our earlier launches before reporting the current native launch."""
    root_key = str(root.resolve())
    current_key = _supervisor_launch_key(launch) if launch else None
    for (owned_root, owned_key), owned in tuple(_OWNED_SUPERVISORS.items()):
        if owned_root == root_key and owned_key != current_key:
            _observe_supervisor_launch(root, owned["launch"])
    return _observe_supervisor_launch(root, launch)


def alive(identity):
    if not identity:
        return False
    for owned in tuple(_OWNED_SUPERVISORS.values()):
        if (_same_process(owned["launch"].get("supervisor"), identity)
                and owned["child"].poll() is None):
            return True
    observed = identity_at(Path("/proc") / str(identity["proc_pid"]))
    if not observed or any(observed.get(key) != identity.get(key)
                           for key in ("pid", "proc_pid", "start_ticks", "pgid", "boot_id")):
        return False
    return (not observed.get("namespace") or not identity.get("namespace")
            or observed["namespace"] == identity["namespace"])


def live_supervisors(root, *, include_execute=False):
    """Reconcile a legacy launch that died before writing its own identity.

    After a normal Popen return, exec completed before the parent releases
    run_lock. A live original supervisor is visible by its exact record path,
    even when the inherited procfs mount uses a different PID namespace. Only
    kernel identities are returned; process arguments are never retained.
    """
    commands = (b"_supervise", b"_execute") if include_execute else (b"_supervise",)
    wanted = os.fsencode(str(root.resolve()))
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            args = (entry / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError as exc:
            raise ValueError("Cannot reconcile the original supervisor through this procfs view") from exc
        if len(args) < 2 or args[-2] not in commands or args[-1] != wanted:
            continue
        identity = identity_at(entry)
        if include_execute and identity is None:
            try:
                raw = (entry / "stat").read_text()
            except (FileNotFoundError, ProcessLookupError):
                continue
            fields = raw[raw.rfind(")") + 2:].split()
            if fields and fields[0] in ("Z", "X"):
                continue
            raise ValueError("Cannot reconcile the original execution wrapper identity")
        if identity and alive(identity):
            found.append(identity)
    return found


def source_observation(project):
    try:
        head = subprocess.run(["git", "-C", str(project), "rev-parse", "--verify", "HEAD"],
                              capture_output=True, text=True, timeout=15)
        if head.returncode:
            return {"kind": "directory", "observed_at": now()}
        dirty = subprocess.run(["git", "-C", str(project), "diff", "--no-ext-diff", "--quiet", "HEAD", "--"],
                               capture_output=True, timeout=15)
        return {"kind": "git_worktree", "head": head.stdout.strip(),
                "tracked_changes": dirty.returncode != 0 if dirty.returncode in (0, 1) else "unknown",
                "untracked_files": "not_inspected", "observed_at": now()}
    except (OSError, subprocess.TimeoutExpired):
        return {"kind": "directory", "git_observation": "unavailable", "observed_at": now()}


def artifact_paths(project, values):
    # An explicit empty selection has no local project paths to validate.
    if isinstance(values, (list, tuple)) and not values:
        return []
    # The selected project may retain its original spelling as a verified root alias.
    # Child links and traversal remain disallowed beneath the current real root.
    project = Path(project).resolve(strict=True)
    paths = []
    for value in values:
        relative = Path(value)
        if relative.is_absolute() or ".." in relative.parts or relative == Path("."):
            raise ValueError("Artifacts must name explicit files or output directories relative to the project.")
        # File selection is local output custody, not a publication operation.
        # Refuse traversal through links; an output manifest stays in its project.
        candidate = project / relative
        for ancestor in (candidate, *candidate.parents):
            if ancestor == project:
                break
            if ancestor.is_symlink():
                raise ValueError("Artifact path traverses a symbolic link: " + value)
        if candidate.resolve().is_relative_to(project):
            paths.append(relative.as_posix())
        else:
            raise ValueError("Artifact path leaves its project: " + value)
    return sorted(set(paths))


def collect_artifacts(project, values):
    records, errors, seen = [], [], set()
    for value in values:
        top = project / value
        try:
            artifact_paths(project, [value])
            if not top.exists():
                errors.append({"path": value, "error": "missing"})
                continue
            paths = [top] if top.is_file() else sorted(top.rglob("*"))
            for path in paths:
                rel = path.relative_to(project).as_posix()
                if rel in seen:
                    continue
                seen.add(rel)
                try:
                    artifact_paths(project, [rel])
                    if path.is_dir():
                        continue
                    if not path.is_file():
                        raise ValueError("Not a regular output file")
                    before = path.stat()
                    digest = hashlib.sha256()
                    with path.open("rb") as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(block)
                    after = path.stat()
                    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                        raise ValueError("Output changed during manifest collection")
                    records.append({"path": rel, "bytes": after.st_size, "sha256": digest.hexdigest(),
                                    "mode": stat.S_IMODE(after.st_mode) & 0o777})
                except (OSError, ValueError) as exc:
                    errors.append({"path": rel, "error": str(exc)})
        except (OSError, ValueError) as exc:
            errors.append({"path": value, "error": str(exc)})
    return {"files": records, "errors": errors, "observed_at": now()}


def capacity_history(root, *, samples=False):
    from native_capacity import observe
    request = read_json(Path(root) / "request.json")
    if request is None:
        raise ValueError("No retained execution for this operation ID.")
    return observe(root, request, samples=samples)


def _execution_observation(root):
    """Read the original lifecycle decisions needed by a waiting log follower.

    Completion, selected-artifact revision, original child wait status and
    process identity stay on the same path used by the full status API.
    Runtime inventories and passive diagnostic views are composed by inspect.
    """
    request = read_json(root / "request.json")
    if request is None:
        raise ValueError("No retained execution for this operation ID.")
    state = read_json(root / "state.json") or {"state": "launch_pending"}
    result = read_json(root / "result.json")
    if result:
        state = result
    launch = read_json(root / "supervisor-launch.json")
    supervisor_exit = observe_supervisor(root, launch)
    owned_running = bool(supervisor_exit and supervisor_exit.get("state") == "running")
    if (state.get("state") == "launch_pending" and launch
            and alive(launch.get("supervisor"))):
        state = {**state, "supervisor": launch["supervisor"]}
    from native_completion import observe
    completion = observe(root, request)
    if (completion and completion.get("outcome")
            and (not result or result.get("state") not in TERMINAL)):
        finalizing = (alive(completion["outcome"].get("supervisor"))
                      and (not result or result.get("state") != "finalization_pending"))
        state = {**(result or {}), **completion["outcome"],
                 "state": "finalizing" if finalizing else "finalization_pending"}
    if state["state"] not in QUIESCENT and not owned_running and not alive(state.get("supervisor")):
        state = {**state, "state": "orphaned_running" if alive(state.get("process")) else "interrupted"}
    from native_artifact_selection import view as artifact_selection_view
    artifact_selection = artifact_selection_view(root, request)
    if (artifact_selection.get("pending") or
            (result is not None and artifact_selection["revision"] !=
             (result.get("artifact_selection") or {}).get("revision", 0))):
        state = {**state, "state": "finalization_pending", "error": "artifact_selection_pending"}
    selected = {key: state[key] for key in ("state", "started_at", "ended_at", "exit_code", "error", "errno", "error_stage", "persistence_wait", "artifacts", "stop_requested", "cancelled_before_dispatch", "cancellation", "resource_history_error") if key in state}
    report = {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "peer": request["intent"]["peer"], "project": request["intent"]["project"],
            "executable": Path(request["intent"]["command"][0]).name,
            "created_at": request["created_at"], "source": request["source"],
            "record": str(root), "log": str(root / "output.log"),
            "supervisor_alive": owned_running or alive(state.get("supervisor")),
            "process_alive": alive(state.get("process")), **selected}
    report["artifact_selection"] = artifact_selection
    if launch:
        report["supervisor_launch"] = launch
    if supervisor_exit:
        report["supervisor_exit"] = supervisor_exit
    if completion:
        report["completion"] = {key: value for key, value in completion.items() if key != "outcome"}
    return request, report

def inspect(root, *, capacity=False, diagnostics=None, runtime_view="full",
            runtime_paths=(), runtime_cursor=None, runtime_limit=100):
    request, report = _execution_observation(root)
    from native_artifact_retention import view as retention_view
    report["artifact_retention"] = retention_view(root, request)
    finalizer = read_json(root / "supervisor-finalizer.json")
    if finalizer is not None:
        report["supervisor_finalizer"] = finalizer
    from native_artifact_checkpoints import view as checkpoint_view
    report["checkpoints"] = checkpoint_view(root, request)
    from native_artifact_delivery import view as delivery_view
    report["deliveries"] = delivery_view(root, request)
    storage = request.get("storage")
    role_paths = request["intent"].get("storage_paths", [])
    if role_paths:
        report["storage_paths"] = role_paths
    if storage:
        report["storage"] = storage
        if request.get("capacity_at_start"):
            report["capacity_at_start"] = request["capacity_at_start"]
    else:
        # Older retained executions stay readable without inventing their cache
        # placement from the reconnecting shell's current environment.
        report["storage"] = {"records_root": str(root.parent),
                             "worker_root": None, "temporary_root": None}
    if capacity:
        from worker_capacity import snapshot
        from swarm_cloud_worker import storage_diagnostic_values
        paths = [request["intent"]["project"], str(root.parent)]
        paths += [row["path"] for row in request["intent"].get("disk", {}).get("paths", [])]
        worker_paths = [report["storage"][key] for key in ("worker_root", "temporary_root")
                        if report["storage"].get(key)]
        paths += worker_paths + [row["path"] for row in role_paths]
        # Diagnose this operation's journal, not every job sharing its parent.
        selected = [str(root), *worker_paths, *[row["path"] for row in role_paths]]
        report["capacity_now"] = snapshot(list(dict.fromkeys(paths)), nearest_existing=True,
                                         **storage_diagnostic_values(diagnostics, selected))
    dependencies = read_json(root / "dependency-recovery.json")
    if dependencies is not None:
        report["dependencies"] = {key: dependencies.get(key) for key in
                                  ("outcome", "counts", "lockfile", "destination", "stage", "install_scripts",
                                   "method", "source", "inventory_sha256", "attachment")}
        report["dependencies"]["report"] = str(root / "dependency-recovery.json")
    if request["intent"].get("memory"):
        report["memory_admission"] = read_json(root / "memory.json")
    from runtime_consumers import snapshot as runtime_snapshot
    runtime_use = runtime_snapshot(root, report, view=runtime_view, paths=runtime_paths,
                                   cursor=runtime_cursor, limit=runtime_limit)
    if runtime_use is not None:
        report["runtime_use"] = runtime_use
    if request["intent"].get("disk"):
        report["disk_admission"] = read_json(root / "disk.json")
    if report.get("state") in CAPACITY_QUEUED_STATES:
        from capacity_fairness import queue_snapshot
        report["capacity_queue"] = queue_snapshot(request, {
            "disk": report.get("disk_admission"), "memory": report.get("memory_admission")})
    stop_release = read_json(root / "stop-release.json")
    if stop_release is not None:
        report["stop_release"] = stop_release
    import capacity_recovery
    failure_recovery = capacity_recovery.observe(sys.modules[__name__], root, request)
    if failure_recovery is not None:
        report["failure_recovery"] = failure_recovery
    if (root / "runtime-handoff.json").is_file():
        import native_runtime_handoff
        handoff = native_runtime_handoff.active(sys.modules[__name__], root)
        report["runtime_handoff"] = {"schema": RUNTIME_HANDOFF_SCHEMA,
            "handoff_id": handoff["handoff_id"], "phase": handoff["phase"],
            "runtime_sha256": handoff["runtime"]["sha256"]}
    history = capacity_history(root)
    if history is not None:
        report["resource_history"] = history
    return report


def finalize(root, *, selection=None, amendment_id=None, reason=None, expected_revision=None, retain_artifacts=False):
    from native_completion import recover
    return recover(root, selection=selection, amendment_id=amendment_id,
                   reason=reason, expected_revision=expected_revision, retain_artifacts=retain_artifacts)


def _launch_supervisor(root, environment):
    # Parent run_lock serializes initial launch and explicit queued recovery.
    previous = read_json(root / "supervisor-launch.json") or {}
    launch = {"schema": "commons.native-supervisor-launch/v1", "started_at": now(),
              "attempt": previous.get("attempt", 0) + 1,
              "parent": process_identity(os.getpid()), "state": "launch_pending"}
    save_json(root / "supervisor-launch.json", launch)
    supervisor_descriptor = supervisor_lock_descriptor(root)
    child_environment = dict(environment)
    child_environment[_SUPERVISOR_LOCK_ENV] = str(supervisor_descriptor)
    child = None
    try:
        descriptor = os.open(root / "supervisor.log", os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "ab", buffering=0) as log:
            child = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "_supervise", str(root)],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                env=child_environment, start_new_session=True, close_fds=True,
                pass_fds=(supervisor_descriptor,))
        _OWNED_SUPERVISORS[(str(root.resolve()), _supervisor_launch_key(launch))] = {
            "key": _supervisor_launch_key(launch), "launch": launch, "child": child}
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = read_json(root / "state.json") or {}
            if state.get("supervisor") or child.poll() is not None:
                break
            time.sleep(0.02)
        state = read_json(root / "state.json") or {}
        identity = state.get("supervisor")
        if not alive(identity) and child.poll() is None:
            observed = live_supervisors(root)
            identity = observed[0] if len(observed) == 1 else None
        launch.update(observed_at=now(), supervisor=identity,
                      state="supervisor_observed" if alive(identity) else
                            "supervisor_exited" if identity else "interrupted_before_state")
        if child.poll() is not None:
            launch["exit_code"] = child.returncode
        save_json(root / "supervisor-launch.json", launch)
    except (OSError, ValueError) as exc:
        if child is None:
            # Only failed process creation owns the canonical launch failure.
            if not isinstance(exc, OSError):
                raise
            save_json(root / "result.json", {"state": "launch_failed", "ended_at": now(), "error": type(exc).__name__, "errno": exc.errno})
        else:
            # An observation write can fail after the native command starts or
            # finishes. Never replace that command's state/result with a parent
            # bookkeeping failure. Its original supervisor remains the owner.
            try:
                save_json(root / "supervisor-launch.json", {**launch,
                          "observation_error": type(exc).__name__, "observed_at": now()})
            except OSError:
                pass
    finally:
        os.close(supervisor_descriptor)
        child_environment.clear()


def resume_capacity(root, *, require_memory=False, launcher=None, recover_failure=None):
    """Recover the original capacity queue, including an explicitly prepared handoff."""
    if (root / "runtime-handoff.json").is_file():
        import native_runtime_handoff
        current = native_runtime_handoff.active(sys.modules[__name__], root)
        if current and current.get("phase") not in ("resumed", "resumed_elsewhere"):
            if recover_failure is not None:
                raise ValueError("Continue the original runtime handoff before selecting a failed result")
            return native_runtime_handoff.resume(sys.modules[__name__], root,
                require_memory=require_memory, launcher=launcher)
    with run_lock(root):
        return _resume_capacity_locked(root, require_memory=require_memory, launcher=launcher,
                                       recover_failure=recover_failure)


def _resume_capacity_locked(root, *, require_memory=False, launcher=None, recover_failure=None):
    """Keep both original locks through all checks and supervisor transfer."""
    # Legacy requests that never reached the supervisor may lack this file.
    # Existing queued records keep their actual inode; it is never replaced.
    with supervisor_lock(root, create=True, reuse_current=True) as descriptor:
        if descriptor is None:
            return {**inspect(root), "reused": True, "resumed": False,
                    "supervisor_lock_held": True}
        return _resume_capacity_owned(root, require_memory=require_memory,
                                      launcher=launcher, recover_failure=recover_failure)


def _legacy_queue_gate_pending(root, state):
    """Keep an old queue gate until its original parent has observed its exit.

    Older queue gates did not inherit .supervisor.lock. A newly acquired inode
    is therefore insufficient evidence about those processes in another procfs
    view. New gates retain the actual transferred inode before child creation.
    """
    launch = read_json(root / "supervisor-launch.json") or {}
    queue = read_json(root / "queue-launch.json") or {}
    current_supervisor = state.get("supervisor")
    launch_matches_owner = (launch.get("supervisor") == current_supervisor or
                            (current_supervisor is None and state.get("state") == "launch_pending"))
    queue_selected = (state.get("supervisor_mode") == "shared_queue_gate" or
                      (launch.get("mode") == "shared_queue_gate" and launch_matches_owner) or
                      (queue.get("supervisor") is not None and
                       queue.get("supervisor") == current_supervisor))
    if not queue_selected:
        return False
    held = supervisor_lock_details(root)
    receipt = launch.get("supervisor_lock")
    if launch_matches_owner and isinstance(receipt, dict) and receipt == held:
        return False
    # Use the maintained, launch-keyed parent wait receipt. Neither an absent
    # PID nor an unlocked newly opened file supplies this original evidence.
    if (launch.get("schema") != NATIVE_LAUNCH_SCHEMA or
            type(launch.get("attempt")) is not int or
            not isinstance(launch.get("parent"), dict) or
            not isinstance(launch.get("started_at"), str)):
        return True
    observed = observe_supervisor(root, launch)
    expected_supervisor = launch.get("supervisor")
    return not (isinstance(observed, dict) and
        observed.get("schema") == "commons.native-supervisor-exit/v1" and
        observed.get("source") == "parent_waitpid" and
        observed.get("state") == "exited" and type(observed.get("exit_code")) is int and
        observed.get("launch_key") == _supervisor_launch_key(launch) and
        observed.get("launch_attempt") == launch["attempt"] and
        observed.get("parent") == launch["parent"] and
        observed.get("supervisor") == expected_supervisor and
        (state.get("supervisor") is None or state.get("supervisor") == expected_supervisor))


def _resume_capacity_owned(root, *, require_memory=False, launcher=None, recover_failure=None):
    """Original recovery body with its run_lock and supervisor_lock held."""
    from swarm_cloud_worker import profile_values
    launch = _launch_supervisor if launcher is None else launcher
    if not callable(launch):
        raise TypeError("launcher must retain the original native supervisor")
    request = read_json(root / "request.json")
    if not request or request.get("schema") != SCHEMA:
        raise ValueError("Select an original native operation with a capacity admission request")
    intent = request["intent"]
    if require_memory and not intent.get("memory"):
        raise ValueError("This original operation has no memory admission request")
    if not (intent.get("memory") or intent.get("disk")):
        raise ValueError("This original operation has no capacity admission request")
    state = read_json(root / "state.json") or {}
    retained_result = read_json(root / "result.json")
    if (alive(state.get("supervisor")) or
            (retained_result and retained_result.get("state") != "launch_failed")):
        return {**inspect(root), "reused": True, "resumed": False}
    if _legacy_queue_gate_pending(root, state):
        return {**inspect(root), "reused": True, "resumed": False,
                "legacy_queue_gate_unresolved": True}
    failure = None
    if recover_failure is not None:
        import capacity_recovery
        failure = capacity_recovery.prepare(sys.modules[__name__], root, recover_failure)
    elif retained_result:
        return {**inspect(root), "reused": True, "resumed": False}
    # A selected failure was validated and archived by the original recovery
    # reader. Its supervisor can have entered starting before command dispatch.
    # The original supervisor reserves completion and creates output.log before
    # Popen. An ended owner with neither marker never dispatched its command.
    interrupted_start = (state.get("state") == "starting" and retained_result is None
                         and _supervisor_ended(state.get("supervisor")))
    recovered_start = state.get("state") == "starting" and (failure is not None or interrupted_start)
    if ((state.get("state") not in CAPACITY_RESUMABLE_STATES and not recovered_start) or
            (root / "process.json").exists() or state.get("process") or (root / "output.log").exists() or
            (root / "command-completion.dat").exists()):
        raise ValueError("Only a retained pre-dispatch capacity queue may resume; preserve started commands")
    if read_json(root / "stop-request.json"):
        raise ValueError("The original queued operation already has a stop request")
    if state.get("state") in {"launch_pending", "starting"}:
        pending_launch = read_json(root / "supervisor-launch.json") or {}
        observed = live_supervisors(root)
        if alive(pending_launch.get("supervisor")) or observed:
            # Reconcile the original parent's launch; a slow interpreter
            # retains ownership before it writes the native state.
            if len(observed) == 1:
                save_json(root / "supervisor-launch.json", {**pending_launch,
                          "schema": "commons.native-supervisor-launch/v1",
                          "state": "live_supervisor_reconciled", "observed_at": now(),
                          "supervisor": observed[0]})
            return {**inspect(root), "reused": True, "resumed": False}
    source_project = None
    command = intent.get("command", [])
    if (isinstance(command, list) and len(command) > 3 and isinstance(command[2], str) and
            Path(command[2]).name == "cloud_source_command.py" and command[3] == "execute"):
        from cloud_source_command import restore_queued_project
        source_project = restore_queued_project(root, request)
    # An interrupted first launch can retain its request before registration.
    # Rejoin that same request and original registry before supervisor
    # acquisition; the frozen source queue now has its original directory.
    from runtime_consumers import register
    register(root, request, registry_root=intent.get("runtime_consumers_root"))
    intent, storage = request["intent"], request.get("storage", {})
    args = argparse.Namespace(peer=intent["peer"], java=intent["java"], node=intent["node"],
        worker_root=storage.get("worker_root"), temp_root=storage.get("temporary_root"),
        records_root=str(root.parent))
    values, prefixes = profile_values(args)
    environment = dict(os.environ, **values)
    if prefixes:
        environment["PATH"] = ":".join(prefixes + [environment.get("PATH", "")])
    if failure is not None:
        failure = capacity_recovery.arm(sys.modules[__name__], root, failure)
    journal = root / ("memory-resume.json" if require_memory else "capacity-resume.json")
    previous = read_json(journal) or {}
    save_json(journal, {"resumed_at": now(),
              "count": previous.get("count", 0) + 1, "previous_supervisor": state.get("supervisor"),
              "operation_id": intent["operation_id"], "command_previously_started": False,
              "supervisor_lock": supervisor_lock_details(root),
              **({"source_project": source_project} if source_project is not None else {}),
              **({"interruption": "supervisor_ended_before_command_allocation",
                  "previous_state": state} if interrupted_start else {})})
    if launcher is not None and getattr(launcher, "retains_native_supervisor", False) is True:
        # Synchronous foreground acquisition records its own identity before
        # launching. A failure before that boundary keeps this dead queue
        # recoverable; an ordinary detached launch retains its original path.
        save_json(root / "state.json", {**state, "resume_pending_at": now()})
    else:
        save_json(root / "state.json", {"state": "launch_pending"})
    launch(root, environment)
    if failure is not None:
        capacity_recovery.acquired(sys.modules[__name__], root, failure)
    return {**inspect(root), "reused": True, "resumed": True}


def resume_memory(root, *, launcher=None, recover_failure=None):
    """Keep the original memory recovery action for jobs declaring memory."""
    return resume_capacity(root, require_memory=True, launcher=launcher, recover_failure=recover_failure)

def start(args, *, launcher=None):
    from swarm_cloud_worker import profile_values
    launch = _launch_supervisor if launcher is None else launcher
    if not callable(launch):
        raise TypeError("launcher must retain the original native supervisor")
    project = Path(args.project).resolve(strict=True)
    if not project.is_dir():
        raise ValueError("Project must be an existing directory.")
    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not command:
        raise ValueError("Supply the exact native command after --.")
    intent = {"operation_id": args.operation_id, "peer": args.peer, "project": str(project),
              "command": command, "java": args.java, "node": args.node,
              "artifacts": artifact_paths(project, args.artifact)}
    conditions = {group: artifact_paths(project, getattr(args, "artifact_on_" + group, ()) or ())
                  for group in ("success", "failure")}
    if any(conditions.values()):
        intent["artifact_conditions"] = conditions
    retaining = getattr(args, "retain_artifacts", False)
    if type(retaining) is not bool:
        raise ValueError("Choose whether to retain original output copies")
    if retaining:
        intent["retain_artifacts"] = True
    from runtime_consumers import register, lexical_path, registry_path
    from swarm_cloud_worker import storage_paths
    role_paths = storage_paths(getattr(args, "storage_path", ()), project)
    if role_paths:
        intent["storage_paths"] = role_paths
    if getattr(args, "runtime_path", None):
        intent["runtime_paths"] = sorted({str(lexical_path(path, project)) for path in args.runtime_path})
    if getattr(args, "runtime_consumers_root", None):
        intent["runtime_consumers_root"] = str(registry_path(args.runtime_consumers_root))
    if getattr(args, "memory_mib", None) is not None:
        from cloud_memory import specification
        intent["memory"] = specification(args.memory_mib,
            getattr(args, "memory_reserve_mib", 256), getattr(args, "memory_reservations_root", None),
            getattr(args, "memory_reclaim", "none"),
            getattr(args, "memory_storage", "included"))
    elif (getattr(args, "memory_reclaim", "none") != "none" or
          getattr(args, "memory_storage", "included") != "included"):
        raise ValueError("Memory modes require an original declared memory_mib peak")
    disk_spaces = getattr(args, "disk_space", None)
    disk_inodes = getattr(args, "disk_inodes", None)
    if disk_spaces or disk_inodes:
        from cloud_disk import specification
        intent["disk"] = specification(disk_spaces, disk_inodes,
            getattr(args, "disk_reserve_mib", 64), getattr(args, "disk_reserve_inodes", 128),
            getattr(args, "disk_reservations_root", None))
    elif (getattr(args, "disk_reserve_mib", 64) != 64 or
          getattr(args, "disk_reserve_inodes", 128) != 128 or
          getattr(args, "disk_reservations_root", None)):
        raise ValueError("Disk reserve and ledger options require a declared disk-space or disk-inodes path")
    # Placement is explicit command intent. Omitted options preserve the old
    # intent shape and therefore reuse existing operations byte-for-byte.
    for key in ("worker_root", "temp_root"):
        supplied = getattr(args, key, None)
        if supplied:
            intent[key] = str(Path(supplied).expanduser().resolve())
    root = run_path(args.operation_id, getattr(args, "records_root", None))
    from native_reservation import require_persistent_control
    # An existing original request still uses its unchanged read/recovery path.
    # A new private /dev record must be rejected before even creating its lock.
    if not (root / "request.json").exists():
        require_persistent_control(root)
    with run_lock(root):
        existing = read_json(root / "request.json")
        if existing:
            if existing["intent"] != intent:
                raise ValueError("Operation ID already records a different command. Preserve it; use a new ID for new work.")
            return {**inspect(root), "reused": True}
        require_persistent_control(root)
        values, prefixes = profile_values(args)
        environment = dict(os.environ, **values)
        if prefixes:
            environment["PATH"] = ":".join(prefixes + [environment.get("PATH", "")])
        from swarm_cloud_worker import placement
        from worker_capacity import snapshot
        locations = placement(values, root.parent)
        disk_paths = [row["path"] for row in intent.get("disk", {}).get("paths", [])]
        role_locations = [row["path"] for row in role_paths]
        request = {"schema": SCHEMA, "intent": intent, "created_at": now(),
                   "source": source_observation(project), "storage": locations,
                   "capacity_at_start": snapshot(
                       list(dict.fromkeys([str(project), *locations.values(), *disk_paths, *role_locations])), nearest_existing=True)}
        save_json(root / "request.json", request)
        save_json(root / "state.json", {"state": "launch_pending"})
        try:
            register(root, request, registry_root=intent.get("runtime_consumers_root"))
        except (OSError, ValueError, KeyError) as exc:
            save_json(root / "result.json", {"state": "launch_failed", "ended_at": now(),
                      "error": "runtime_registration_failed", "error_type": type(exc).__name__})
            raise
        # The same lifetime lock remains held through every original launcher.
        # Environment is inherited privately by the supervisor; never serialize it.
        with supervisor_lock(root, create=True) as descriptor:
            if descriptor is None:
                return {**inspect(root), "reused": True, "supervisor_lock_held": True}
            launch(root, environment)
        return {**inspect(root), "reused": False}


def execute_command(root):
    # Child self-observation works when procfs uses host PIDs and the kernel
    # omits task/children. exec preserves this process's identity and group.
    request = read_json(root / "request.json")
    identity = process_identity(os.getpid())
    if not identity:
        raise ValueError("The command could not retain its own procfs identity.")
    # The original command cannot execute until its identity is durable.
    # A full journal leaves this same wrapper waiting in its original group.
    while True:
        try:
            save_json(root / "process.json", identity)
            break
        except OSError as exc:
            if not space_exhausted(exc):
                raise
            time.sleep(1.0)
    from native_artifact_checkpoints import environment as checkpoint_environment
    os.environ.update(checkpoint_environment(root, request))
    command = request["intent"]["command"]
    try:
        os.execvp(command[0], command)
    except OSError as exc:
        print(json.dumps({"state": "exec_failed", "error": type(exc).__name__, "errno": exc.errno}), file=sys.stderr)
        return 127


def supervise(root, *, on_finalized=None, supervisor_descriptor=None):
    if on_finalized is not None and not callable(on_finalized):
        raise TypeError("on_finalized must be a synchronous source-owned callback")
    # The caller can transfer its locked open-file description through exec,
    # Popen or the existing shared queue. Never open a second description when
    # the lifetime lock has already been acquired for this exact supervisor.
    if supervisor_descriptor is None:
        while True:
            try:
                supervisor_descriptor = os.open(root / ".supervisor.lock",
                    os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
                break
            except OSError as exc:
                if not space_exhausted(exc):
                    raise
                time.sleep(1.0)
    with supervisor_lock(root, descriptor=supervisor_descriptor) as descriptor:
        if descriptor is None:
            return 0
        if (read_json(root / "result.json") or (root / "process.json").exists()
                or (root / "output.log").exists() or (root / "command-completion.dat").exists()):
            return 0
        return _supervise_owned(root, on_finalized=on_finalized)


def _retain_supervisor_failure(root, failed, recorder):
    """Keep a sanitized terminal observation when a new result file cannot save."""
    recorded = save_observation(root / "result.json", failed)
    outcome = {**failed, "result_recorded": recorded}
    if recorder is not None:
        recorder.sample("supervisor_failed", force=True, outcome=outcome)
    if not recorded:
        # This existing log may also be full; the preallocated resource frame is
        # the independent fallback. Do not print argv, environment or exception text.
        notice = {key: outcome[key] for key in
                  ("state", "ended_at", "error", "errno", "error_stage",
                   "stop_requested", "result_recorded") if key in outcome}
        try:
            os.write(2, (json.dumps({"native_supervisor_failure": notice}) + "\n").encode())
        except (OSError, ValueError, TypeError):
            pass
    return recorded



def _supervisor_finalized(root, request, supervisor, on_finalized):
    """Run one source-owned tail while this supervisor retains its admissions."""
    control = root / "supervisor-finalizer.json"
    selected = {"schema": NATIVE_FINALIZER_SCHEMA, "operation_id": request["intent"]["operation_id"],
                "supervisor": supervisor, "state": "running", "started_at": now()}
    try:
        raw = (root / "result.json").read_bytes()
        result = json.loads(raw)
        if (result.get("state") not in TERMINAL | {"finalization_pending"}
                or type(result.get("exit_code")) is not int):
            raise ValueError("A finalizer requires the actual ended command result")
        selected["native_result_sha256"] = hashlib.sha256(raw).hexdigest()
        # This is status, not the callback's provider commit. Its source-owned
        # caller retains the exact durable request before each side effect.
        save_observation(control, selected)
        outcome = on_finalized(root=root, request=json.loads(json.dumps(request)),
                               result=result, supervisor=dict(supervisor))
        encoded = json.dumps(outcome, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > 65536:
            raise ValueError("Finalizer outcome exceeds its 64 KiB retained result")
        if (root / "result.json").read_bytes() != raw:
            raise ValueError("A finalizer changed its original native command result")
        save_json(control, {**selected, "state": "completed", "ended_at": now(), "outcome": outcome})
        return True
    except BaseException as exc:
        failure = {**selected, "state": "failed", "ended_at": now(), "error": type(exc).__name__}
        if isinstance(exc, OSError) and type(exc.errno) is int:
            failure["errno"] = exc.errno
        save_observation(control, failure)
        return False


def _supervise_owned(root, *, on_finalized=None):
    request = read_json(root / "request.json")
    intent = request["intent"]
    state = {"state": "starting", "started_at": now(), "supervisor": process_identity(os.getpid())}
    stopped = False
    state_write_pending = False
    state_write_attempt = 0.0

    def stop_requested(_signal, _frame):
        nonlocal stopped
        stopped = True

    def cancelled():
        nonlocal stopped
        requested = read_json(root / "stop-request.json")
        if requested and requested.get("supervisor") == state["supervisor"]:
            stopped = True
        return stopped

    def stop_before_dispatch():
        _retain_supervisor_failure(root, {**state, "state": "launch_failed",
            "ended_at": now(), "stop_requested": True, "error": "stopped_before_dispatch",
            "error_stage": phase}, capacity_recorder)
        return 1

    def observe_state():
        nonlocal state_write_pending, state_write_attempt
        state_write_attempt = time.monotonic()
        state_write_pending = not save_observation(root / "state.json", state)

    def transition(selected):
        changed = state["state"] != selected or "persistence_wait" in state
        state["state"] = selected
        state.pop("persistence_wait", None)
        if changed or state_write_pending:
            observe_state()
        if capacity_recorder is not None:
            capacity_recorder.sample(selected)

    def wait_for_storage(error, phase):
        if not space_exhausted(error):
            raise error
        prior = state.get("persistence_wait") or {}
        state["persistence_wait"] = {"phase": phase, "errno": error.errno,
            "since": prior.get("since", now()), "observed_at": now()}
        observe_state()
        if capacity_recorder is not None:
            capacity_recorder.sample("waiting_for_storage")
        time.sleep(1.0)

    signal.signal(signal.SIGTERM, stop_requested)
    signal.signal(signal.SIGINT, stop_requested)
    admission = None
    disk_admission = None
    completion = None
    phase = "capacity_setup"
    capacity_recorder = None
    command_ended = False
    try:
        # Retain this supervisor's acknowledgement before any acquisition.
        while True:
            if cancelled():
                return stop_before_dispatch()
            try:
                save_json(root / "state.json", state)
                state_write_pending = False
                break
            except OSError as exc:
                wait_for_storage(exc, "supervisor_state")
        # Use the original bounded resource file throughout this supervisor's
        # queue lifetime. Observation remains optional and takes no reservation.
        from native_capacity import Recorder
        capacity_recorder = Recorder.open(root, request, supervisor=state["supervisor"])
        if capacity_recorder is None or capacity_recorder.fd is None:
            state["resource_history_error"] = (capacity_recorder.value.get("last_error")
                if capacity_recorder is not None else {"kind": "ObservationUnavailable"})
        if intent.get("memory"):
            from cloud_memory import MemoryAdmission
            admission = MemoryAdmission(root, request, state["supervisor"])
        if intent.get("disk"):
            from cloud_disk import DiskAdmission
            disk_admission = DiskAdmission(root, request, state["supervisor"])
        from native_completion import reserve, finish
        from runtime_consumers import refresh
        memory_waiting = False
        memory_observed_at = 0.0
        queued_state = "queued_disk" if disk_admission is not None else (
            "queued_memory" if admission is not None else "starting")
        transition(queued_state)
        while True:
            if cancelled():
                return stop_before_dispatch()
            phase = "capacity_reservation"
            try:
                # Register the original RAM waiter before disk admission. It
                # takes no RAM, but survives disk waits with its original age.
                if (admission is not None and disk_admission is not None and
                        (not memory_waiting or time.monotonic() - memory_observed_at >= 5)):
                    memory_decision = admission.attempt(reserve=False)
                    memory_observed_at = time.monotonic()
                    memory_waiting = True
                    if memory_decision["state"] == "memory_request_exceeds_limit":
                        save_json(root / "result.json", {**state, "state": "launch_failed", "ended_at": now(),
                                  "stop_requested": False, "error": memory_decision["state"]})
                        return 1
                if disk_admission is not None:
                    # Use the same attainable RAM criterion as joint aging.
                    # An aged waiter must be able to observe its full disk
                    # budget while existing RAM claims drain.
                    allow_allocation = (admission is None or (
                        memory_decision.get("capacity_feasible") is True and
                        all(memory_decision["requested_bytes"] + intent["memory"]["reserve_bytes"] <=
                            row["admission_available_bytes"] + row.get("resident_private_credit_bytes", 0)
                            for row in memory_decision["resources"])))
                    decision = disk_admission.attempt(allow_allocation=allow_allocation)
                    allocated_disk_budget = decision.get("reason") == "same_writer_budget_reserved"
                    if decision["state"] == "disk_request_exceeds_limit":
                        save_json(root / "result.json", {**state, "state": "launch_failed", "ended_at": now(),
                                  "stop_requested": False, "error": decision["state"]})
                        return 1
                    if decision["state"] != "admitted":
                        # Keep the nonreserved memory waiter visible so an
                        # aged request can accumulate both resources together.
                        if memory_waiting:
                            admission.relinquish("waiting_for_disk")
                        transition("queued_disk")
                        time.sleep(1.0)
                        continue
                if admission is not None:
                    decision = admission.attempt()
                    memory_decision = decision
                    memory_observed_at = time.monotonic()
                    memory_waiting = True
                    if decision["state"] == "memory_request_exceeds_limit":
                        save_json(root / "result.json", {**state, "state": "launch_failed", "ended_at": now(),
                                  "stop_requested": False, "error": decision["state"]})
                        return 1
                    if decision["state"] != "admitted":
                        if disk_admission is not None:
                            disk_admission.relinquish()
                        transition("queued_memory")
                        # Keep the positive disk observation within the shared
                        # 15s aging window without allocating every second.
                        time.sleep(5.0 if disk_admission is not None and allocated_disk_budget else 1.0)
                        continue
                transition("starting")
                phase = "runtime_registration"
                refresh(root)
                phase = "completion_reservation"
                if completion is None:
                    completion = reserve(root, request)
                phase = "command_log"
                descriptor = os.open(root / "output.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                break
            except OSError as exc:
                if not space_exhausted(exc):
                    raise
                # Nothing has dispatched. Release unused capacity where the
                # ledger can commit; otherwise its existing reservation remains
                # conservative. Recheck both resources before the next launch.
                for selected in (admission, disk_admission):
                    if selected is None:
                        continue
                    try:
                        selected.relinquish("waiting_for_storage")
                    except OSError as release_error:
                        if not space_exhausted(release_error):
                            raise
                state["state"] = queued_state
                wait_for_storage(exc, phase)
        with os.fdopen(descriptor, "ab", buffering=0) as log:
            if cancelled():
                return stop_before_dispatch()
            # Retry only an unavailable optional recorder after mandatory capture
            # storage has succeeded; keep the same queue history when it exists.
            if capacity_recorder is None or capacity_recorder.fd is None:
                capacity_recorder = Recorder.open(root, request, supervisor=state["supervisor"])
            if capacity_recorder is None or capacity_recorder.fd is None:
                state["resource_history_error"] = (capacity_recorder.value.get("last_error")
                    if capacity_recorder is not None else {"kind": "ObservationUnavailable"})
            if capacity_recorder is not None:
                capacity_recorder.sample("dispatch", force=True)
            phase = "command_execution"
            process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "_execute", str(root)], cwd=intent["project"],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, close_fds=True)
            deadline = time.monotonic() + 5
            while not (root / "process.json").exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            state.update(state="running", process=read_json(root / "process.json"))
            state.pop("persistence_wait", None)
            observe_state()
            residency = None
            if admission is not None:
                from cloud_residency import Publisher
                from cloud_memory import _resident
            if stopped:
                os.killpg(os.getpgrp(), signal.SIGTERM)
            forwarded = False
            while True:
                if state_write_pending and time.monotonic() - state_write_attempt >= 5:
                    observe_state()
                # A child wrapper can itself await a durable process record.
                # Adopt that same identity when storage becomes writable.
                if not state.get("process"):
                    identity = read_json(root / "process.json")
                    if identity:
                        state["process"] = identity
                        observe_state()
                if admission is not None and residency is None and state.get("process"):
                    residency = Publisher(root, request, state["supervisor"], state["process"], _resident)
                if residency is not None:
                    observation = residency.sample()
                    if capacity_recorder is not None:
                        capacity_recorder.process_sample(observation)
                if capacity_recorder is not None:
                    capacity_recorder.sample("running")
                requested = read_json(root / "stop-request.json")
                if requested and requested.get("supervisor") == state["supervisor"] and not forwarded:
                    # Signal from inside the command's own namespace. A later
                    # shell may have a different meaning for the same PID.
                    forwarded = True
                    state["stop_requested"] = True
                    observe_state()
                    os.killpg(os.getpgrp(), signal.SIGTERM)
                try:
                    code = process.wait(timeout=0.2)
                    command_ended = True
                    break
                except subprocess.TimeoutExpired:
                    pass
            completion.retain({**state, "state": "completed" if code == 0 else "failed",
                               "ended_at": now(), "exit_code": code, "stop_requested": stopped})
            if capacity_recorder is not None:
                capacity_recorder.sample("command_exited", force=True, outcome=completion.outcome)
            log.flush()
            os.fsync(log.fileno())
        phase = "command_finalization"
        result = finish(root, request, completion.outcome)
        return 0 if result["state"] in TERMINAL else 1
    except BaseException as exc:
        # Retain the failure type without copying inherited credentials or a
        # command's arguments into the operator's status response.
        if completion is not None and completion.outcome is not None:
            failed = {**completion.outcome, "state": "finalization_pending", "error": type(exc).__name__}
        else:
            failed = {**state, "state": "launch_failed" if "process" not in state else "orphaned_running",
                      "ended_at": now(), "error": type(exc).__name__, "stop_requested": stopped}
        failed["error_stage"] = phase
        if isinstance(exc, OSError) and type(exc.errno) is int:
            failed["errno"] = exc.errno
        _retain_supervisor_failure(root, failed, capacity_recorder)
        return 1
    finally:
        try:
            if capacity_recorder is not None:
                try:
                    outcome = read_json(root / "result.json")
                    capacity_recorder.sample("supervisor_finished", force=True, outcome=outcome)
                except (OSError, ValueError, KeyError, TypeError):
                    pass
                finally:
                    capacity_recorder.close()
            if completion is not None:
                completion.close()
            if on_finalized is not None and command_ended:
                if not _supervisor_finalized(root, request, state["supervisor"], on_finalized):
                    return NATIVE_FINALIZER_FAILED_EXIT
        finally:
            for selected, filename in ((admission, "memory.json"), (disk_admission, "disk.json")):
                if selected is None:
                    continue
                try:
                    selected.finish()
                except Exception as exc:
                    # The retained exit stays authoritative. A later admission
                    # releases a dead reservation using original native liveness.
                    try:
                        prior = read_json(root / filename) or {}
                        save_observation(root / filename, {**prior, "state": "release_pending",
                                  "release_error": type(exc).__name__, "observed_at": now()})
                    except (OSError, ValueError, TypeError):
                        pass


def stream_log(root, *, offset=0, follow=False):
    while True:
        try:
            with (root / "output.log").open("rb") as stream:
                stream.seek(offset)
                for block in iter(lambda: stream.read(65536), b""):
                    sys.stdout.buffer.write(block)
                    sys.stdout.buffer.flush()
                    offset += len(block)
        except FileNotFoundError:
            pass
        # Frequent followers need lifecycle decisions, not repeated runtime
        # inventories, queue expansion or passive history decoding.
        if follow:
            _, report = _execution_observation(root)
        else:
            report = inspect(root)
        owned_running = report.get("supervisor_exit", {}).get("state") == "running"
        if not follow or (not owned_running and
                          (report["state"] in QUIESCENT or report["state"] == "interrupted")):
            if follow:
                # Return the established full status ABI once. Re-observe here
                # so a concurrent original handoff/resume keeps its follower.
                report = inspect(root)
                owned_running = report.get("supervisor_exit", {}).get("state") == "running"
                if owned_running or (report["state"] not in QUIESCENT and
                                     report["state"] != "interrupted"):
                    time.sleep(0.15)
                    continue
            # A terminal result is written after the final log fsync. Drain any
            # final bytes which appeared between this read and the status read.
            if follow and report["state"] in TERMINAL:
                try:
                    with (root / "output.log").open("rb") as stream:
                        stream.seek(offset)
                        for block in iter(lambda: stream.read(65536), b""):
                            sys.stdout.buffer.write(block)
                            offset += len(block)
                    sys.stdout.buffer.flush()
                except FileNotFoundError:
                    pass
            return report, offset
        time.sleep(0.15)


def _supervisor_ended(identity):
    """Require an ended original process; an unreadable procfs is not proof."""
    if not isinstance(identity, dict) or not all(identity.get(key) is not None
            for key in ("proc_pid", "start_ticks", "boot_id")):
        return False
    try:
        if identity["boot_id"] != Path("/proc/sys/kernel/random/boot_id").read_text().strip():
            return True
        proc_pid = int(identity["proc_pid"])
        if proc_pid < 1:
            return False
    except (OSError, ValueError, TypeError):
        return False
    try:
        raw = (Path("/proc") / str(proc_pid) / "stat").read_text()
    except (FileNotFoundError, ProcessLookupError):
        return True
    except OSError:
        return False
    fields = raw[raw.rfind(")") + 2:].split()
    return (len(fields) > 19 and
            (fields[0] in ("Z", "X") or fields[19] != str(identity["start_ticks"])))



def _release_cancelled_capacity(root, request, state):
    """Finish the original reservations; a repeated stop retries failed release."""
    previous = read_json(root / "stop-release.json")
    if previous and previous.get("ok"):
        return previous
    outcomes = {}
    for resource in ("memory", "disk"):
        if not request["intent"].get(resource):
            continue
        try:
            if resource == "memory":
                from cloud_memory import MemoryAdmission
                admission = MemoryAdmission(root, request, state.get("supervisor"))
                # This Stop process did not supervise the original child.
                finished = admission.finish(record_child_peak=False)
                schema = MEMORY_ADMISSION_SCHEMA
            else:
                from cloud_disk import DiskAdmission
                admission = DiskAdmission(root, request, state.get("supervisor"))
                finished = admission.finish()
                schema = DISK_ADMISSION_SCHEMA
            if finished is not None:
                if (not isinstance(finished, dict) or finished.get("schema") != schema or
                        finished.get("operation_id") != request["intent"]["operation_id"] or
                        finished.get("record") != str(root.resolve()) or
                        finished.get("index") != str(admission.directory / "reservations.json") or
                        finished.get("reservation_key") != admission.key or
                        finished.get("state") not in ("released", "reserved_orphan")):
                    raise ValueError("Release result does not name the original reservation")
                # The helper returns only after the existing index commits.
                # Optional status publication may still be pending.
                outcomes[resource] = {key: finished[key] for key in (
                    "state", "native_state", "index", "reservation_key", "released_at", "observation")}
            else:
                # Preserve compatibility with an older installed finish helper.
                observation = read_json(root / (resource + ".json")) or {}
                outcomes[resource] = {"state": observation.get("state", "release_pending")}
        except Exception as exc:
            outcomes[resource] = {"state": "release_pending", "error_type": type(exc).__name__,
                                  **({"errno": exc.errno} if isinstance(exc, OSError) else {})}
    try:
        from runtime_consumers import release
        usage = release(root)
        outcomes["runtime"] = {"state": "released" if usage.get("released") else usage.get("state")}
    except Exception as exc:
        outcomes["runtime"] = {"state": "release_pending", "error_type": type(exc).__name__}
    result = {"operation_id": request["intent"]["operation_id"], "observed_at": now(),
              "ok": all(item.get("state") in ("released", "unregistered") for item in outcomes.values()),
              "resources": outcomes}
    save_json(root / "stop-release.json", result)
    return result



def _prepared_command_log(root):
    path = root / "output.log"
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return {"record": str(path), "present": False}
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size != 0 or os.read(descriptor, 1):
            raise ValueError("The original command log is not an empty prepared allocation")
        after, named = os.fstat(descriptor), path.lstat()
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, key) != getattr(after, key) or
               getattr(after, key) != getattr(named, key) for key in keys):
            raise ValueError("The original prepared command log changed during selection")
        return {"record": str(path), "present": True, "bytes": 0,
                "device": before.st_dev, "inode": before.st_ino,
                "sha256": hashlib.sha256(b"").hexdigest()}
    finally:
        os.close(descriptor)


def _cancel_prepared_command(root, state):
    """Finish an ended pre-exec allocation through the original stop lifecycle."""
    if (state.get("state") not in (*CAPACITY_QUEUED_STATES, "starting") or
            state.get("process") or not _supervisor_ended(state.get("supervisor")) or
            any(os.path.lexists(root / name) for name in ("process.json", "result.json"))):
        return None
    request_raw = (root / "request.json").read_bytes()
    request = json.loads(request_raw)
    if (request.get("schema") != SCHEMA or
            run_path(request["intent"]["operation_id"], root.parent) != root):
        raise ValueError("Select the original native record for this prepared command")
    launch = read_json(root / "supervisor-launch.json") or {}
    if launch.get("supervisor") and not _supervisor_ended(launch["supervisor"]):
        return None
    # The original supervisor holds this lease for its complete lifetime.
    # Record-lock ownership serializes explicit start/resume/stop callers.
    descriptor = os.open(root / ".supervisor.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("The original supervisor lease is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return None
        from native_completion import prepared_snapshot
        completion = prepared_snapshot(root, request)
        if completion is None:
            return None
        log = _prepared_command_log(root)
        # A child can wait in _execute before its durable identity write. That
        # exact wrapper must also be absent before declaring a pre-exec stop.
        if live_supervisors(root, include_execute=True):
            return None
        if (read_json(root / "state.json") != state or
                (root / "request.json").read_bytes() != request_raw or
                any(os.path.lexists(root / name) for name in ("process.json", "result.json")) or
                not _supervisor_ended(state.get("supervisor")) or
                (launch.get("supervisor") and not _supervisor_ended(launch["supervisor"]))):
            return None
        if prepared_snapshot(root, request) != completion or _prepared_command_log(root) != log:
            raise ValueError("The original prepared command changed before cancellation")
        selected = {"boundary": "prepared_command", "request_sha256": hashlib.sha256(request_raw).hexdigest(),
                    "completion": completion, "log": log}
        cancellation = read_json(root / "stop-request.json")
        if cancellation is not None:
            if (cancellation.get("supervisor") != state["supervisor"] or
                    (cancellation.get("prepared_command") is not None and
                     cancellation["prepared_command"] != selected)):
                raise ValueError("Preserve the original stop request and its selected command")
        else:
            cancellation = {"requested_at": now(), "signal": None, "supervisor": state["supervisor"],
                            "reason": "cancelled_before_dispatch", "prepared_command": selected}
            save_json(root / "stop-request.json", cancellation)
        # The stop survives an interrupted result write. Existing prepared
        # bytes remain intact, and a later stop retries this same cancellation.
        save_json(root / "result.json", {**state, "state": "launch_failed", "ended_at": now(),
                  "stop_requested": True, "cancelled_before_dispatch": True,
                  "error": "stopped_before_command_dispatch", "cancellation": selected})
        _release_cancelled_capacity(root, request, state)
        return {**inspect(root), "stop_requested": True, "stop_state": "cancelled_before_dispatch"}
    finally:
        os.close(descriptor)


def stop(root, *, expected_supervisor=None, blocking=True):
    with run_lock(root, blocking=blocking):
        if (root / "runtime-handoff.json").is_file():
            import native_runtime_handoff
            native_runtime_handoff.cancel_pending(sys.modules[__name__], root,
                                                   expected_supervisor=expected_supervisor)
        return _stop_locked(root, expected_supervisor=expected_supervisor)


def _stop_locked(root, *, expected_supervisor=None, authored_stop_request=None):
    """Original stop path; an explicit handoff has already journaled its own request."""
    report = inspect(root)
    state = read_json(root / "state.json") or {}
    result = read_json(root / "result.json") or {}
    if report["state"] in QUIESCENT:
        matches = expected_supervisor is None or state.get("supervisor") == expected_supervisor
        cancelled = False
        if authored_stop_request is None and matches:
            import capacity_recovery
            cancelled = capacity_recovery.cancel(sys.modules[__name__], root)
            result = read_json(root / "result.json") or {}
        if result.get("cancelled_before_dispatch") and matches:
            cancelled = True
            _release_cancelled_capacity(root, read_json(root / "request.json"), state)
            report = inspect(root)
        return {**report, "stop_requested": cancelled,
                **({"stop_state": "cancelled_before_dispatch"} if cancelled else {})}
    if expected_supervisor is not None and state.get("supervisor") != expected_supervisor:
        return {**report, "stop_requested": False, "stop_state": "supervisor_changed"}
    if alive(state.get("supervisor")):
        if authored_stop_request is not None:
            if (authored_stop_request.get("supervisor") != state["supervisor"] or
                    authored_stop_request.get("signal") != "SIGTERM"):
                raise ValueError("The handoff stop must name the exact original supervisor")
            stop_request = authored_stop_request
        else:
            stop_request = {"requested_at": now(), "signal": "SIGTERM", "supervisor": state["supervisor"]}
        save_json(root / "stop-request.json", stop_request)
        return {**report, "stop_requested": True}
    if authored_stop_request is None:
        cancelled = _cancel_prepared_command(root, state)
        if cancelled is not None:
            return cancelled
    if (authored_stop_request is None and state.get("state") in CAPACITY_QUEUED_STATES
            and not state.get("process")
            and not any((root / name).exists() for name in
                        ("process.json", "output.log", "command-completion.dat"))
            and _supervisor_ended(state.get("supervisor"))):
        request = read_json(root / "request.json")
        if request["intent"].get("memory") or request["intent"].get("disk"):
            cancellation = read_json(root / "stop-request.json") or {
                "requested_at": now(), "signal": None, "supervisor": state["supervisor"],
                "reason": "cancelled_before_dispatch"}
            # Persist the original stop first: recovery stays stopped even
            # if a full filesystem interrupts terminal-result persistence.
            save_json(root / "stop-request.json", cancellation)
            resource = "disk" if state["state"] == "queued_disk" else "memory"
            save_json(root / "result.json", {**state, "state": "launch_failed", "ended_at": now(),
                      "stop_requested": True, "cancelled_before_dispatch": True,
                      "error": "stopped_before_" + resource + "_dispatch"})
            _release_cancelled_capacity(root, request, state)
            return {**inspect(root), "stop_requested": True, "stop_state": "cancelled_before_dispatch"}
    # An orphan may still be stopped in an ordinary shared PID namespace.
    # Never reinterpret a PID from another shell's nested namespace.
    identity = state.get("process")
    current = process_identity(os.getpid())
    if (alive(identity) and current and current.get("namespace")
            and identity["namespace"] == current["namespace"]):
        if identity["pgid"] == os.getpgrp():
            raise ValueError("Recorded command unexpectedly shares the caller's process group.")
        os.killpg(identity["pgid"], signal.SIGTERM)
        return {**report, "stop_requested": True}
    return {**report, "stop_requested": False, "stop_state": "recorded_supervisor_unavailable"}


def exit_status(report):
    if report["state"] == "finalization_pending":
        return 75
    code = report.get("exit_code")
    if code is None:
        return 1 if report["state"] in TERMINAL else 75
    return code if code >= 0 else 128 - code


def launch_options(sub):
    """Declare the original native launch options for composing worker commands."""
    sub.add_argument("peer")
    sub.add_argument("--operation-id", required=True)
    sub.add_argument("--project", required=True)
    sub.add_argument("--java", choices=("17", "21"))
    sub.add_argument("--node", choices=("18", "24"))
    sub.add_argument("--artifact", action="append", default=[], help="output required for either exit outcome")
    sub.add_argument("--artifact-on-success", action="append", default=[], help="output required only for exit code zero")
    sub.add_argument("--artifact-on-failure", action="append", default=[], help="output required only for a nonzero exit")
    sub.add_argument("--retain-artifacts", action="store_true",
                     help="copy selected output bytes into the original records directory before terminal publication")
    sub.add_argument("--report-format", choices=("summary", "full"), default="full",
                     help="bounded state, actual exit and log tail, or the full native status")
    from runtime_consumers import runtime_options
    runtime_options(sub)
    sub.add_argument("--memory-mib", type=int, help="original job's declared peak memory; queue before command start")
    sub.add_argument("--memory-reserve-mib", type=int, default=256,
                     help="shared control-plane headroom retained at admission")
    sub.add_argument("--memory-reservations-root", help="same shared VM reservation directory used by other jobs")
    sub.add_argument("--memory-reclaim", choices=MEMORY_ADMISSION_RECLAIM_MODES, default="none",
                     help="clean-cache includes the explicit kernel cache estimate; hard counters remain visible")
    sub.add_argument("--memory-storage", choices=MEMORY_ADMISSION_STORAGE_MODES, default="included",
                     help="included: whole-operation peak; additional: process-only peak plus declared tmpfs growth")
    sub.add_argument("--disk-space", action="append", default=[], metavar="PATH=MIB",
                     help="additional filesystem MiB this command can create; repeat for separate paths")
    sub.add_argument("--disk-inodes", action="append", default=[], metavar="PATH=COUNT",
                     help="additional filesystem inodes this command can create; repeat for separate paths")
    sub.add_argument("--disk-reserve-mib", type=int, default=64,
                     help="shared filesystem byte headroom retained at admission (default: 64 MiB)")
    sub.add_argument("--disk-reserve-inodes", type=int, default=128,
                     help="shared filesystem inode headroom retained at admission (default: 128)")
    sub.add_argument("--disk-reservations-root", "--disk-ledger-root", dest="disk_reservations_root",
                     help="same shared VM disk reservation directory used by other jobs")
    sub.add_argument("--queue-directory",
                     help="existing private shared admission controller; preserves this native request")
    from swarm_cloud_worker import storage_options, storage_path_options
    storage_options(sub)
    storage_path_options(sub)


def report_value(report, mode="full"):
    from native_result_view import select
    return select(report, mode)


def launch_selected(args):
    """Launch and follow through the original supervisor and output lifecycle."""
    queue_directory = getattr(args, "queue_directory", None)
    if queue_directory is None:
        report = start(args)
    else:
        from native_queue import QueueLaunch
        report = start(args, launcher=QueueLaunch(sys.modules[__name__], queue_directory))
    report_format = getattr(args, "report_format", "full")
    if args.action == "run":
        print(json.dumps(report_value(report, report_format)), file=sys.stderr, flush=True)
        report, offset = stream_log(Path(report["record"]), follow=True)
        print(json.dumps(report_value({**report, "next_log_offset": offset}, report_format)), file=sys.stderr, flush=True)
        return exit_status(report)
    print(json.dumps(report_value(report, report_format), indent=2))
    return 0 if report["state"] not in ("launch_failed", "interrupted") else 1


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command = []
    if argv and argv[0] in ("run", "start") and "--" in argv:
        separator = argv.index("--")
        command, argv = argv[separator + 1:], argv[:separator]
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    for action in ("run", "start"):
        sub = subs.add_parser(action)
        launch_options(sub)
        if action == "run":
            sub.set_defaults(report_format="summary")
    for action in ("status", "logs", "stop", "amend-memory", "resume-memory", "resume-capacity", "finalize",
                   "review-runtime", "amend-runtime"):
        sub = subs.add_parser(action)
        sub.add_argument("operation_id")
        sub.add_argument("--records-root", help="same native execution records directory used at launch")
        sub.add_argument("--report-format", choices=("summary", "full"), default="full")
        if action == "amend-memory":
            sub.add_argument("--amendment-id", required=True, help="stable ID for this exact memory declaration")
            sub.add_argument("--expected-memory-sha256", required=True, help="observed original memory declaration SHA-256")
            sub.add_argument("--memory-mib", type=int, required=True)
            sub.add_argument("--memory-reserve-mib", type=int, help="omit to retain the original reserve")
            sub.add_argument("--memory-reclaim", choices=MEMORY_ADMISSION_RECLAIM_MODES,
                             help="omit to retain the original reclamation mode")
            sub.add_argument("--memory-storage", choices=MEMORY_ADMISSION_STORAGE_MODES,
                             help="omit to retain the original whole-envelope or additional-storage contract")
            sub.add_argument("--reason", required=True, help="concrete change behind this memory estimate")
        if action in ("review-runtime", "amend-runtime"):
            sub.add_argument("--runtime-path", action="append", default=[],
                             help="required files/directories in the complete replacement runtime set")
            sub.add_argument("--optional-runtime-path", action="append", default=[],
                             help="consumed paths that may be absent; shares the runtime-path selection limit")
        if action == "amend-runtime":
            sub.add_argument("--amendment-id", required=True)
            sub.add_argument("--expected-runtime-selection-sha256", required=True,
                             help="exact reviewed original-record/path selection")
            sub.add_argument("--reason", required=True)
        if action == "status":
            from swarm_cloud_worker import storage_diagnostic_options
            storage_diagnostic_options(sub)
            from runtime_catalog import options as runtime_read_options
            runtime_read_options(sub)
        if action == "finalize":
            sub.add_argument("--retain-artifacts", action="store_true",
                             help="retain original output bytes on this completed command or finish its interrupted copies")
            sub.add_argument("--artifact-selection", type=Path,
                             help="JSON replacement with always/success/failure path lists; use - for stdin")
            sub.add_argument("--amendment-id", help="stable ID for this exact artifact-selection amendment")
            sub.add_argument("--reason", help="why this completed operation needs a replacement selection")
            sub.add_argument("--expected-artifact-revision", type=int,
                             help="optional observed artifact revision for concurrent editors")
        if action == "logs":
            sub.add_argument("--offset", type=int, default=0)
            sub.add_argument("--follow", action="store_true")
        if action in ("resume-memory", "resume-capacity"):
            sub.add_argument("--queue-directory",
                             help="existing private shared admission controller for this original record")
            sub.add_argument("--follow", action="store_true", help="retain the foreground owner until the original command ends")
            sub.add_argument("--recover-failure", metavar="SHA256",
                             help="archive and recover the exact original pre-dispatch failure shown by status")
    for action in ("checkpoint", "checkpoints", "checkpoint-info", "recover-checkpoint"):
        sub = subs.add_parser(action)
        sub.add_argument("operation_id", nargs="?", default=os.environ.get("SWARM_NATIVE_OPERATION_ID"))
        original_record = os.environ.get("SWARM_NATIVE_RECORD")
        sub.add_argument("--records-root", default=str(Path(original_record).parent) if original_record else None)
        if action == "checkpoints":
            sub.add_argument("--offset", type=int, default=0)
            sub.add_argument("--limit", type=int, default=25)
        else:
            sub.add_argument("--checkpoint-id", required=True)
        if action == "checkpoint":
            sub.add_argument("--label")
            sub.add_argument("--artifact", action="append", required=True,
                             help="closed phase file or directory relative to the original project")
        if action == "recover-checkpoint":
            sub.add_argument("--snapshot", required=True, help="exact saved checkpoint snapshot SHA-256")
    for action in ("prepare-delivery", "deliver", "deliveries", "delivery-info", "recover-delivery", "download-delivery"):
        sub = subs.add_parser(action)
        sub.add_argument("operation_id", nargs="?", default=os.environ.get("SWARM_NATIVE_OPERATION_ID"))
        original_record = os.environ.get("SWARM_NATIVE_RECORD")
        sub.add_argument("--records-root", default=str(Path(original_record).parent) if original_record else None)
        if action == "deliveries":
            sub.add_argument("--offset", type=int, default=0)
            sub.add_argument("--limit", type=int, default=25)
        else:
            sub.add_argument("--delivery-id", required=True)
        if action == "prepare-delivery":
            sub.add_argument("--label")
            sub.add_argument("--artifact", action="append", required=True,
                             help="complete closed output file or directory relative to the original project")
        if action in ("deliver", "recover-delivery"):
            sub.add_argument("--plan", required=True, help="exact prepared delivery plan SHA-256")
        if action == "recover-delivery":
            sub.add_argument("--snapshot", required=True, help="exact retained checkpoint snapshot SHA-256")
        if action == "download-delivery":
            sub.add_argument("--sha256", required=True, help="exact completed archive SHA-256")
            sub.add_argument("--directory", required=True, help="existing owned private receiving directory")
    reservation = subs.add_parser("reservation-status",
        help="read one exact original memory/disk reservation without a control-record write")
    reservation.add_argument("--kind", choices=("memory", "disk"), required=True)
    reservation.add_argument("--ledger-root", required=True)
    reservation.add_argument("--boot-id", required=True)
    reservation.add_argument("--reservation-key", required=True)
    listing = subs.add_parser("list")
    listing.add_argument("--limit", type=int, default=20)
    listing.add_argument("--records-root", help="native execution records directory to inspect")
    from runtime_catalog import options as runtime_read_options
    runtime_read_options(listing, listing=True)
    args = parser.parse_args(argv)
    args.command = command
    try:
        if args.action in ("run", "start"):
            return launch_selected(args)
        if args.action == "reservation-status":
            from native_reservation import inspect_reservation
            report = inspect_reservation(sys.modules[__name__], args.kind, args.ledger_root,
                                         args.boot_id, args.reservation_key)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 75 if report["state"] == "unresolved" else 0
        if args.action == "list":
            if args.limit < 1:
                raise ValueError("List limit must be positive.")
            paths = sorted(runs_root(args.records_root).glob("*/request.json"), key=lambda p: p.stat().st_mtime_ns, reverse=True)
            reports = [inspect(path.parent, runtime_view=args.runtime_view) for path in paths[:args.limit]]
            print(json.dumps({"executions": reports, "retained": len(paths), "shown": len(reports)}, indent=2))
            return 0
        root = run_path(args.operation_id, args.records_root)
        if args.action in ("checkpoint", "checkpoints", "checkpoint-info", "recover-checkpoint"):
            import native_artifact_checkpoints as checkpoints
            if args.action == "checkpoint":
                report = checkpoints.capture(root, args.checkpoint_id, args.artifact, label=args.label)
            elif args.action == "checkpoints":
                report = checkpoints.listing(root, offset=args.offset, limit=args.limit)
            elif args.action == "checkpoint-info":
                report = checkpoints.detail(root, args.checkpoint_id)
            else:
                report = checkpoints.recover(root, args.checkpoint_id, expected_snapshot=args.snapshot)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 75 if report.get("state") in ("collecting", "incomplete") else 0
        if args.action in ("prepare-delivery", "deliver", "deliveries", "delivery-info", "recover-delivery", "download-delivery"):
            import native_artifact_delivery as delivery
            if args.action == "prepare-delivery":
                report = delivery.prepare(root, args.delivery_id, args.artifact, label=args.label)
            elif args.action == "deliver":
                report = delivery.deliver(root, args.delivery_id, expected_plan=args.plan)
            elif args.action == "deliveries":
                report = delivery.listing(root, offset=args.offset, limit=args.limit)
            elif args.action == "delivery-info":
                report = delivery.info(root, args.delivery_id)
            elif args.action == "recover-delivery":
                report = delivery.recover(root, args.delivery_id, expected_plan=args.plan, expected_snapshot=args.snapshot)
            else:
                report = delivery.copy_archive(root, args.delivery_id, args.directory, expected_sha256=args.sha256)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 75 if report.get("state") in ("checkpoint_pending", "packaging") else 0
        if args.action in ("review-runtime", "amend-runtime"):
            import runtime_declarations
            if args.action == "review-runtime":
                report = runtime_declarations.review_request(
                    root, selected_paths=args.runtime_path, optional_paths=args.optional_runtime_path)
            else:
                report = runtime_declarations.amend_request(root, selected_paths=args.runtime_path,
                    optional_paths=args.optional_runtime_path, amendment_id=args.amendment_id,
                    expected_selection_sha256=args.expected_runtime_selection_sha256, reason=args.reason)
            print(json.dumps(report, indent=2))
            return 0
        if args.action == "amend-memory":
            from cloud_memory import amend_request
            report = amend_request(root, amendment_id=args.amendment_id,
                                   expected_memory_sha256=args.expected_memory_sha256,
                                   memory_mib=args.memory_mib, reason=args.reason,
                                   reserve_mib=args.memory_reserve_mib,
                                   reclaim_mode=args.memory_reclaim, storage_mode=args.memory_storage)
            print(json.dumps(report_value(report, args.report_format), indent=2))
            return 0
        if args.action == "finalize":
            selection = None
            if args.artifact_selection is not None:
                selection = json.load(sys.stdin) if str(args.artifact_selection) == "-" else json.loads(
                    args.artifact_selection.read_text(encoding="utf-8"))
            report = finalize(root, selection=selection, amendment_id=args.amendment_id,
                              reason=args.reason, expected_revision=args.expected_artifact_revision,
                              retain_artifacts=args.retain_artifacts)
            print(json.dumps(report_value(report, args.report_format), indent=2))
            return exit_status(report)
        if args.action in ("resume-memory", "resume-capacity"):
            if args.follow:
                from native_foreground import resume_foreground
                report = resume_foreground(sys.modules[__name__], args.operation_id, args.records_root,
                                           action=args.action, recover_failure=args.recover_failure,
                                           report_format=args.report_format,
                                           queue_directory=args.queue_directory)
            else:
                resume = resume_memory if args.action == "resume-memory" else resume_capacity
                options = {"recover_failure": args.recover_failure}
                if args.queue_directory is not None:
                    from native_queue import QueueLaunch
                    options["launcher"] = QueueLaunch(sys.modules[__name__], args.queue_directory)
                report = resume(root, **options)
            print(json.dumps(report_value(report, args.report_format)), file=sys.stderr if args.follow else sys.stdout, flush=True)
            if args.follow:
                report, offset = stream_log(root, follow=True)
                print(json.dumps(report_value({**report, "next_log_offset": offset}, args.report_format)), file=sys.stderr, flush=True)
                return exit_status(report)
            return 0
        if args.action == "status":
            from runtime_catalog import arguments as runtime_read_arguments
            report = inspect(root, capacity=True, diagnostics=args, **runtime_read_arguments(args))
            print(json.dumps(report_value(report, args.report_format), indent=2))
            return 2 if report["capacity_now"].get("storage_consumers", {}).get("status") == "error" else 0
        if args.action == "logs":
            if args.offset < 0:
                raise ValueError("Log offset must be nonnegative.")
            report, offset = stream_log(root, offset=args.offset, follow=args.follow)
            print(json.dumps({"operation_id": args.operation_id, "state": report["state"], "next_log_offset": offset}), file=sys.stderr)
            return exit_status(report) if args.follow else 0
        if args.action == "stop":
            print(json.dumps(report_value(stop(root), args.report_format), indent=2))
            return 0
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "_supervise":
        inherited_lock = os.environ.pop(_SUPERVISOR_LOCK_ENV, None)
        raise SystemExit(supervise(Path(sys.argv[2]).resolve(),
            supervisor_descriptor=int(inherited_lock) if inherited_lock is not None else None))
    if len(sys.argv) == 3 and sys.argv[1] == "_execute":
        raise SystemExit(execute_command(Path(sys.argv[2]).resolve()))
    raise SystemExit(main())
