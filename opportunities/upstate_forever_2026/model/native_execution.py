"""Progress and recoverable failure records for the existing native run."""
from __future__ import annotations

import copy
import errno
import fcntl
import json
import logging
import os
from pathlib import Path
import socket
import sys

from .common import atomic_json, canonical, now, relative_file, verify_file
from .model_selection import run_models, run_scope
from .reuse import verify_stage

RESERVE_HEADER = b"upstate.native-recovery-reserve/v1\n"
RESERVE_NAME = ".native-recovery-reserve"
RESERVE_PENDING_NAME = RESERVE_NAME + ".allocating"


def resource_status():
    """Keep optional observations from replacing a model or storage failure."""
    try:
        return _resource_status()
    except Exception as error:
        return {"read_errors": [{"source": "native-resources",
                                 "type": type(error).__name__}]}


def _resource_status():
    """Observe this process and its visible cgroup without changing execution.

    Memory and cache observations belong to execution records, never scientific
    stage identities. Cgroup counters include other processes in the group;
    memory.stat's shmem is included in file, so these values are not additive.
    """
    result = {"recorded_at": now(), "pid": os.getpid()}
    names = ("GDAL_CACHEMAX", "GDAL_NUM_THREADS", "GDAL_MAX_DATASET_POOL_RAM_USAGE",
             "VSI_CACHE", "VSI_CACHE_SIZE", "OMP_NUM_THREADS",
             "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "MALLOC_ARENA_MAX")
    result["environment"] = {name: os.environ.get(name) for name in names}
    errors = []

    def problem(name, error):
        errors.append({"source": name, "type": type(error).__name__,
                       "message": str(error)})

    try:
        fields = {}
        for line in Path("/proc/self/status").read_text().splitlines():
            name, _, value = line.partition(":")
            if name in ("VmRSS", "VmHWM", "VmSize"):
                amount, unit = value.split()
                if unit == "kB":
                    fields[name + "_bytes"] = int(amount) * 1024
            elif name == "Threads":
                fields["threads"] = int(value)
        result["process"] = fields
    except (OSError, ValueError) as error:
        problem("/proc/self/status", error)

    try:
        membership = next((line.split(":", 2)[2]
                           for line in Path("/proc/self/cgroup").read_text().splitlines()
                           if line.startswith("0::")), None)
        if membership is not None:
            def unescape(value):
                for before, after in (("\\040", " "), ("\\011", "\t"),
                                      ("\\012", "\n"), ("\\134", "\\")):
                    value = value.replace(before, after)
                return value

            candidates = []
            for line in Path("/proc/self/mountinfo").read_text().splitlines():
                left, separator, right = line.partition(" - ")
                if not separator or right.split()[0] != "cgroup2":
                    continue
                fields = left.split()
                root, mount = Path(unescape(fields[3])), Path(unescape(fields[4]))
                try:
                    relative = Path(membership).relative_to(root)
                except ValueError:
                    continue
                if ".." not in relative.parts:
                    candidates.append((len(root.parts), mount / relative))
            if candidates:
                directory = max(candidates, key=lambda row: row[0])[1]
                group = {"version": 2, "membership": membership, "path": str(directory)}
                for name in ("memory.current", "memory.peak", "memory.max", "memory.high",
                             "memory.swap.current", "memory.swap.max"):
                    try:
                        value = (directory / name).read_text().strip()
                        group[name] = value if value == "max" else int(value)
                    except FileNotFoundError:
                        continue
                    except (OSError, ValueError) as error:
                        problem(str(directory / name), error)
                for name in ("memory.events", "memory.events.local", "memory.stat"):
                    try:
                        values = {key: int(value) for key, value in
                                  (line.split() for line in (directory / name).read_text().splitlines())}
                        if name == "memory.stat":
                            selected = ("anon", "file", "shmem", "kernel", "file_mapped",
                                        "file_dirty", "file_writeback", "slab", "sock",
                                        "active_anon", "inactive_anon", "active_file", "inactive_file")
                            values = {key: values[key] for key in selected if key in values}
                        group[name] = values
                    except FileNotFoundError:
                        continue
                    except (OSError, ValueError) as error:
                        problem(str(directory / name), error)
                result["cgroup"] = group
            else:
                result["cgroup"] = {"version": 2, "membership": membership,
                                    "state": "mount_not_resolved"}
    except (OSError, ValueError, IndexError) as error:
        problem("cgroup2", error)

    # GetCacheMax initializes GDAL's cache on its first call. Read it only
    # after actual cached blocks establish that the engine already initialized
    # the cache. Resource observation must not choose that initialization time.
    gdal = sys.modules.get("osgeo.gdal")
    if gdal is not None:
        values = {}
        for name in ("GetCacheUsed", "GetUsablePhysicalRAM"):
            function = getattr(gdal, name, None)
            if function is not None:
                try:
                    values[name] = int(function())
                except Exception as error:
                    problem("osgeo.gdal." + name, error)
        if values.get("GetCacheUsed", 0) > 0:
            try:
                values["GetCacheMax"] = int(gdal.GetCacheMax())
            except Exception as error:
                problem("osgeo.gdal.GetCacheMax", error)
        result["gdal_bytes"] = values
    if errors:
        result["read_errors"] = errors
    return result


def storage_status(directory):
    """Report space available to this process on the actual run filesystem."""
    try:
        value = os.statvfs(directory)
        return {"available_bytes": value.f_bavail * value.f_frsize,
                "free_bytes": value.f_bfree * value.f_frsize,
                "total_bytes": value.f_blocks * value.f_frsize,
                "available_inodes": value.f_favail, "total_inodes": value.f_files}
    except OSError as exc:
        return {"error": {"type": type(exc).__name__, "message": str(exc)}}


def storage_exhausted(error):
    """Recognize actual capacity failures across native and coordinator wrappers."""
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        failure = getattr(error, "native_failure", None)
        if isinstance(failure, dict) and failure.get("kind") == "storage_exhausted":
            return True
        if isinstance(error, OSError) and error.errno in (
                errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
            return True
        message = str(error).lower()
        if "no space left on device" in message or "disk quota exceeded" in message:
            return True
        error = error.__cause__ or error.__context__
    return False


def _error(exc):
    causes = []
    current = exc
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        item = {"type": type(current).__name__, "message": str(current)}
        if isinstance(current, OSError):
            item["errno"] = current.errno
        causes.append(item)
        current = current.__cause__ or current.__context__
    result = dict(causes[0])
    if len(causes) > 1:
        result["causes"] = causes[1:]
    if storage_exhausted(exc):
        result["kind"] = "storage_exhausted"
        result["recovery"] = ("Make space on the recorded run filesystem, then continue "
                              "this same run ID to reuse its completed native stages.")
    elif isinstance(exc, (KeyboardInterrupt, SystemExit)):
        result["kind"] = "interrupted"
        result["recovery"] = "Continue this same run ID to reuse its completed native stages."
    else:
        result["kind"] = "execution_failed"
        result["recovery"] = ("Correct the recorded runtime, source or output error, "
                              "then continue this same run ID.")
    return result


class NativeExecution:
    """Journal one attempt while the caller holds the original run lock.

    A small, allocated reserve on the run filesystem is released before failure
    publication. It gives atomic run.json replacement room even when native
    working files exhausted the remaining space. It is metadata capacity, not an
    estimate or promise of the storage required by the scientific calculation.
    """

    def __init__(self, directory, state):
        self.directory = Path(directory)
        self.path = self.directory / "run.json"
        self.reserve = self.directory / RESERVE_NAME
        self.pending_reserve = self.directory / RESERVE_PENDING_NAME
        self.state = state
        self.reserve_owned = False
        self.pending_owned = False

    def _release(self):
        for flag, path in (("reserve_owned", self.reserve),
                           ("pending_owned", self.pending_reserve)):
            if getattr(self, flag):
                path.unlink(missing_ok=True)
                setattr(self, flag, False)

    def _discard_reserve(self, path, *, incomplete=False):
        if not (path.exists() or path.is_symlink()):
            return
        if path.is_symlink() or not path.is_file():
            raise ValueError("Native recovery reserve is not an original regular file")
        with path.open("rb") as original:
            header = original.read(len(RESERVE_HEADER))
        if header != RESERVE_HEADER and not (incomplete and RESERVE_HEADER.startswith(header)):
            raise ValueError("Native recovery reserve has an unrecognized identity")
        path.unlink()

    def _allocate(self):
        # The original run lock also protects these two private reserve names.
        # Only the staging name may have an incomplete header after a killed
        # allocation; a published reserve must retain its complete identity.
        self._discard_reserve(self.pending_reserve, incomplete=True)
        self.pending_owned = False
        self._discard_reserve(self.reserve)
        self.reserve_owned = False
        size = max(256 * 1024, 2 * len(canonical(self.state)) + 65536)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        fd = os.open(self.pending_reserve, flags, 0o600)
        self.pending_owned = True
        with os.fdopen(fd, "wb") as out:
            out.write(RESERVE_HEADER)
            left = size - len(RESERVE_HEADER)
            block = b"\0" * 65536
            while left:
                body = block[:min(left, len(block))]
                out.write(body)
                left -= len(body)
            out.flush()
            os.fsync(out.fileno())
        self.reserve_owned = True
        os.replace(self.pending_reserve, self.reserve)
        self.pending_owned = False
        self.state["execution"]["recovery_reserve_capacity_bytes"] = size

    def _record_storage(self):
        current = self.state["execution"]
        current["storage"] = storage_status(self.directory)
        current["storage_recorded_at"] = now()
        current["resources"] = resource_status()

    def __enter__(self):
        previous = self.state.get("execution")
        history = self.state.setdefault("execution_history", [])
        if previous:
            previous = copy.deepcopy(previous)
            previous["recorded_run_state"] = self.state["state"]
            if previous.get("state") == "running":
                previous.update(state="interrupted", recovered_at=now())
            if self.state.get("error"):
                previous["error"] = copy.deepcopy(self.state["error"])
            if self.state.get("validation"):
                previous["validation"] = copy.deepcopy(self.state["validation"])
            history.append(previous)
        elif self.state.get("error") or self.state["state"] == "running":
            history.append({"state": self.state["state"], "updated_at": self.state.get("updated_at"),
                            "error": copy.deepcopy(self.state.get("error")),
                            "validation": copy.deepcopy(self.state.get("validation")),
                            "recovered_at": now()})
        self.state.update(state="running", updated_at=now(),
                          execution={"attempt": len(history) + 1, "state": "running",
                                     "phase": "starting", "started_at": now(),
                                     "pid": os.getpid(), "host": socket.gethostname()})
        self.state.pop("error", None)
        self.state.pop("validation", None)
        try:
            self._allocate()
            self._record_storage()
            self.save()
        except BaseException as exc:
            self.fail(exc)
            raise
        return self

    def save(self):
        if (self.reserve_owned and 2 * len(canonical(self.state)) + 65536
                > self.state["execution"].get("recovery_reserve_capacity_bytes", 0)):
            self._allocate()
        self.state["updated_at"] = now()
        self.state["execution"]["updated_at"] = self.state["updated_at"]
        atomic_json(self.path, self.state)

    def phase(self, name, *, model=None, artifact=None):
        current = self.state["execution"]
        current.update(phase=name, phase_started_at=now())
        for field, value in (("model", model), ("artifact", artifact)):
            if value is None:
                current.pop(field, None)
            else:
                current[field] = value
        self._record_storage()
        self.save()
        logging.getLogger(__name__).info("Native run %s: %s%s%s", self.state["id"], name,
            " " + model if model else "", " " + artifact if artifact else "")

    def reuse_progress(self, value):
        """Retain the throttled original-stage lookup and verified transfer state."""
        self.state["execution"]["stage_reuse"] = copy.deepcopy(value)
        self.save()

    def finish(self):
        current = self.state["execution"]
        stamp = now()
        current.update(state="complete", phase="complete", phase_started_at=stamp, completed_at=stamp)
        current.pop("model", None)
        current.pop("artifact", None)
        self._record_storage()
        self.save()

    def fail(self, exc):
        """Retain the primary failure even if publishing that failure also fails."""
        failure = _error(exc)
        failure["phase"] = self.state["execution"]["phase"]
        for name in ("model", "artifact"):
            if name in self.state["execution"]:
                failure[name] = self.state["execution"][name]
        failure["storage_at_failure"] = storage_status(self.directory)
        failure["resources_at_failure"] = resource_status()
        failure["storage_recorded_at"] = now()
        try:
            self._release()
        except OSError as release_error:
            failure["reserve_release_error"] = _error(release_error)
        self.state.update(state="failed", updated_at=now(), error=failure)
        self.state["execution"].update(state="failed", failed_at=now())
        self._record_storage()
        self.state["model_scope"] = run_scope(self.state)
        try:
            self.save()
        except (OSError, ValueError, TypeError) as publication_error:
            failure["state_publication_error"] = _error(publication_error)
        # Callers keep the original exception type and message. The ordinary CLI
        # can emit the richer record without replacing the original cause.
        try:
            exc.native_failure = failure
        except (AttributeError, TypeError):
            pass
        try:
            print(json.dumps({"schema": "upstate.native-run-event/v1",
                              "run_id": self.state["id"], "state": "failed", "error": failure},
                             ensure_ascii=False), file=sys.stderr, flush=True)
        except (OSError, ValueError):
            pass

    def __exit__(self, kind, exc, traceback):
        if exc is not None:
            self.fail(exc)
        else:
            try:
                self._release()
            except OSError as release_error:
                logging.getLogger(__name__).warning("Native recovery reserve cleanup: %s", release_error)
        return False


def _active(directory):
    """Inspect the same flock as execution without creating a file or a process."""
    try:
        fd = os.open(directory / ".run.lock", os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True
    finally:
        os.close(fd)


def _log_tail(directory, limit):
    path = directory / "native.log"
    if not path.exists():
        return {"path": "native.log", "bytes": 0, "offset": 0, "text": ""}
    path = relative_file(directory, "native.log")
    with path.open("rb") as stream:
        size = os.fstat(stream.fileno()).st_size
        offset = max(0, size - limit)
        stream.seek(offset)
        body = stream.read(limit)
    return {"path": "native.log", "bytes": size, "offset": offset,
            "text": body.decode("utf-8", "replace")}


def inspect_execution(workspace, key, *, verify=False, log_bytes=16384):
    """Read current execution, storage and retained outputs without running a model."""
    if (isinstance(log_bytes, bool) or not isinstance(log_bytes, int)
            or not 0 <= log_bytes <= 65536):
        raise ValueError("log_bytes must be an integer between 0 and 65536")
    state = workspace.inspect_run(key)
    directory = workspace.root / "runs" / key
    active = _active(directory)
    visible = "interrupted" if state["state"] == "running" and not active else state["state"]
    artifacts = {}
    for name, descriptor in state.get("artifacts", {}).items():
        row = {"path": descriptor["path"], "bytes": descriptor["bytes"],
               "units": descriptor.get("units")}
        try:
            path = verify_file(directory, descriptor) if verify else relative_file(directory, descriptor["path"])
            if path.stat().st_size != descriptor["bytes"]:
                raise ValueError("Retained output length differs")
            row["availability"] = "verified" if verify else "present"
        except (OSError, ValueError) as exc:
            row.update(availability="unavailable", error=_error(exc))
        artifacts[name] = row
    stages = {}
    for name in run_models(state):
        stage = state.get("stages", {}).get(name)
        if not stage:
            stages[name] = {"state": "pending"}
            continue
        row = {"state": "retained", "completed_at": stage.get("completed_at"),
               "files": len(stage.get("files", {})), "reused_from": stage.get("reused_from")}
        if verify:
            try:
                verify_stage(directory, stage)
                row["state"] = "verified"
            except (OSError, ValueError, KeyError) as exc:
                row.update(state="unavailable", error=_error(exc))
        stages[name] = row
    result = {"schema": "upstate.native-run-status/v1", "run_id": key,
              "workspace_id": workspace.project["id"], "state": visible,
              "recorded_state": state["state"], "active": active,
              "selection": state["selection"], "model_scope": run_scope(state),
              "execution": state.get("execution"), "error": state.get("error"),
              "execution_history": state.get("execution_history", []),
              "storage": storage_status(directory), "stages": stages, "artifacts": artifacts,
              "verification": {"artifacts": "sha256" if verify else "presence_and_length",
                               "stages": "sha256" if verify else "not_requested"},
              "continue_argv": [sys.executable, "-B", "-m", "model.cli",
                                "--workspace", str(workspace.root), "run", key]}
    if log_bytes:
        try:
            result["log"] = _log_tail(directory, log_bytes)
        except (OSError, ValueError) as exc:
            result["log"] = {"path": "native.log", "error": _error(exc)}
    return result
