"""Retain resource observations beside one original native command.

Sampling belongs to the existing supervisor. The two preallocated slots keep
the last complete observation readable if a write is interrupted or disk fills.
This module reads kernel counters; it never admits work, signals or retries it.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import time

SCHEMA = "commons.native-capacity-history/v1"
FILENAME = "capacity-history.dat"
SLOT_BYTES = 32768
FILE_BYTES = SLOT_BYTES * 2
MAGIC = b"CNCCAP1"
INTERVAL_SECONDS = 5
RECENT_SAMPLES = 32


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def _binding(request):
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "intent_sha256": hashlib.sha256(_encoded(request["intent"])).hexdigest()}


def _error(exc):
    return {"kind": type(exc).__name__, "errno": getattr(exc, "errno", None)}


def _frame(value):
    body = _encoded(value)
    header = MAGIC + b"\n" + str(len(body)).encode() + b"\n"
    header += hashlib.sha256(body).hexdigest().encode() + b"\n"
    if len(header) + len(body) > SLOT_BYTES:
        raise ValueError("Resource history exceeds its reserved slot")
    return (header + body).ljust(SLOT_BYTES, b"\0")


def _reconcile_history_intent(value, request):
    """Read an original history through the existing capacity amendment chain."""
    expected = _binding(request)
    if (not isinstance(value, dict) or
            any(value.get(key) != expected[key] for key in ("schema", "operation_id"))):
        raise ValueError("Resource history differs from its original command")
    retained = value.get("intent_sha256")
    if retained == expected["intent_sha256"]:
        return None
    if (not isinstance(retained, str) or len(retained) != 64 or
            any(character not in "0123456789abcdef" for character in retained)):
        raise ValueError("Resource history intent binding is invalid")
    try:
        if __package__:
            from .runtime_consumers import RuntimeUseError, reconcile_capacity_amendments
        else:
            from runtime_consumers import RuntimeUseError, reconcile_capacity_amendments
    except ImportError as exc:
        raise ValueError("Original capacity amendment reader is unavailable") from exc
    try:
        joined = reconcile_capacity_amendments({"intent_sha256": retained}, request)
    except (RuntimeUseError, ValueError, TypeError, KeyError) as exc:
        raise ValueError("Resource history differs from its original capacity lineage") from exc
    references = joined.get("intent_amendments", []) if isinstance(joined, dict) else None
    if (not isinstance(joined, dict) or
            joined.get("intent_sha256") != expected["intent_sha256"] or
            not isinstance(references, list) or not references):
        raise ValueError("Resource history has no original capacity amendment chain")
    # The authoritative full chain remains in request.json. Keep this passive
    # record constant in size even after many supported declaration changes.
    return {"retained_intent_sha256": retained,
            "current_intent_sha256": expected["intent_sha256"],
            "source": "request.json", "amendment_count": len(references),
            "amendments_sha256": hashlib.sha256(_encoded(references)).hexdigest()}


def _decode(data, request):
    if not data.strip(b"\0"):
        return None
    magic, raw_size, digest, tail = data.split(b"\n", 3)
    size = int(raw_size)
    if magic != MAGIC or not 0 < size <= len(tail):
        raise ValueError("Invalid resource history frame")
    body = tail[:size]
    if hashlib.sha256(body).hexdigest().encode() != digest:
        raise ValueError("Incomplete resource history write")
    value = json.loads(body)
    reconciliation = _reconcile_history_intent(value, request)
    if type(value.get("sequence")) is not int or value["sequence"] < 1:
        raise ValueError("Resource history sequence is invalid")
    if reconciliation is not None:
        # Read-only inspection keeps the recorded intent explicit. The owning
        # supervisor adopts the current binding only when it writes a sample.
        value["pending_intent_reconciliation"] = reconciliation
    return value


def _read(fd, request):
    metadata = os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != FILE_BYTES:
        raise ValueError("Resource history storage changed")
    values, damaged = [], 0
    for offset in (0, SLOT_BYTES):
        try:
            value = _decode(os.pread(fd, SLOT_BYTES, offset), request)
            if value:
                values.append(value)
        except (UnicodeError, ValueError, KeyError, TypeError):
            damaged += 1
    if not values:
        raise ValueError("No complete resource observation remains")
    return max(values, key=lambda value: value["sequence"]), damaged


def observe(root, request, *, samples=False):
    """Read the latest complete slot; old native operations remain readable."""
    path = Path(root) / FILENAME
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    except OSError as exc:
        return {"schema": SCHEMA, "status": "unavailable", "error": _error(exc)}
    try:
        value, damaged = _read(fd, request)
        result = {**value, "record": str(path), "reserved_bytes": FILE_BYTES,
                  "recovered_slots": damaged, "samples_retained": len(value["recent"]),
                  "samples_compacted": value["sequence"] - len(value["recent"])}
        if not samples:
            result.pop("recent")
        return result
    except (OSError, ValueError, TypeError, KeyError) as exc:
        return {"schema": SCHEMA, "status": "unavailable", "record": str(path), "error": _error(exc)}
    finally:
        os.close(fd)


def _track(row, field, value, at, *, minimum=False):
    if type(value) is not int:
        return
    prior = row.get(field)
    if prior is None or (value < prior if minimum else value > prior):
        row[field], row[field + "_at"] = value, at


def _counters(row, values):
    if not isinstance(values, dict):
        return
    previous = row.setdefault("last_counters", {})
    first = row.setdefault("first_counters", {})
    delta = row.setdefault("counter_increases", {})
    for key, value in values.items():
        if type(value) is not int:
            continue
        first.setdefault(key, value)
        if key in previous:
            if value >= previous[key]:
                delta[key] = delta.get(key, 0) + value - previous[key]
            else:
                row["counter_resets"] = row.get("counter_resets", 0) + 1
        previous[key] = value


PROCESS_SCHEMA = "commons.native-process-memory-history/v1"
PROCESS_CONTRIBUTORS = 4
PROCESS_LIMIT = 256


def _process_identity(value):
    if not isinstance(value, dict):
        raise ValueError("Original process identity is missing")
    if (type(value.get("proc_pid")) is not int or value["proc_pid"] < 1 or
            not isinstance(value.get("start_ticks"), str) or
            not value["start_ticks"].isdecimal() or len(value["start_ticks"]) > 24 or
            not isinstance(value.get("boot_id"), str) or
            not 1 <= len(value["boot_id"]) <= 64):
        raise ValueError("Original process identity is invalid")
    if (any(type(value.get(name)) is not int or value[name] < 1 for name in ("pid", "pgid")) or
            (value.get("namespace") is not None and
             (not isinstance(value["namespace"], str) or len(value["namespace"]) > 64))):
        raise ValueError("Original process namespace identity is invalid")
    return {name: value.get(name) for name in
            ("proc_pid", "pid", "start_ticks", "pgid", "boot_id", "namespace")}


def _process_key(value):
    return value["boot_id"], value["proc_pid"], value["start_ticks"]


def _observed_tree(value, process):
    """Project the owning sampler's already validated tree without a procfs scan."""
    if not isinstance(value, dict) or value.get("scope") != "original_command_descendants":
        raise ValueError("No validated original descendant observation")
    members = value.get("processes")
    if not isinstance(members, list) or not 1 <= len(members) <= PROCESS_LIMIT:
        raise ValueError("Original descendant observation is outside its limit")
    seen, measured = {}, []
    for offset, member in enumerate(members):
        identity = _process_identity(member["identity"])
        pid, parent, depth = identity["proc_pid"], member["parent_proc_pid"], member["depth"]
        if (pid in seen or type(parent) is not int or type(depth) is not int or
                identity["boot_id"] != process["boot_id"]):
            raise ValueError("Original descendant identity differs")
        if offset == 0:
            if _process_key(identity) != _process_key(process) or depth != 0:
                raise ValueError("Original descendant root differs")
        elif parent not in seen or depth != seen[parent] + 1:
            raise ValueError("Original descendant ancestry differs")
        seen[pid] = depth
        if member.get("status") != "original_process":
            continue
        private, rss = member.get("private_bytes"), member.get("rss_bytes")
        if type(private) is not int or type(rss) is not int or not 0 <= private <= rss:
            raise ValueError("Original descendant counters are invalid")
        measured.append({"identity": identity, "parent_proc_pid": parent, "depth": depth,
                         "rss_bytes": rss, "private_bytes": private})
    rss = sum(member["rss_bytes"] for member in measured)
    private = sum(member["private_bytes"] for member in measured)
    unavailable = len(members) - len(measured)
    if (value.get("process_count") != len(members) or value.get("rss_bytes") != rss or
            value.get("private_bytes") != private or
            value.get("unavailable_processes") != unavailable):
        raise ValueError("Original descendant totals differ")
    group = value.get("cgroup_path")
    if group is not None and (not isinstance(group, str) or len(group) > 4096):
        raise ValueError("Original descendant cgroup path is invalid")
    contributors = sorted(measured, key=lambda member:
                          (-member["private_bytes"], -member["rss_bytes"],
                           member["identity"]["proc_pid"]))[:PROCESS_CONTRIBUTORS]
    return {"scope": value["scope"], "cgroup_path": group,
            "observed_processes": len(members), "measured_processes": len(measured),
            "unavailable_processes": unavailable, "truncated": bool(value.get("truncated")),
            "rss_sum_bytes": rss, "private_sum_bytes": private,
            "largest_private_processes": contributors,
            "contributors_omitted": max(0, len(measured) - len(contributors))}


def _process_observation(value, root, request, boot_id):
    if (not isinstance(value, dict) or
            value.get("schema") != "commons.native-process-residency/v1" or
            value.get("scope") != "exact_original_command" or
            value.get("record") != str(root.resolve()) or
            value.get("operation_id") != request["intent"]["operation_id"] or
            value.get("request_sha256") != hashlib.sha256(_encoded(request)).hexdigest()):
        raise ValueError("Process observation differs from this original command")
    process = _process_identity(value.get("process"))
    supervisor = _process_identity(value.get("supervisor"))
    if process["boot_id"] != boot_id or supervisor["boot_id"] != boot_id:
        raise ValueError("Process observation differs from this kernel boot")
    if (type(value.get("sequence")) is not int or value["sequence"] < 1 or
            type(value.get("monotonic_ns")) is not int or value["monotonic_ns"] < 0 or
            not isinstance(value.get("observed_at"), str) or not 1 <= len(value["observed_at"]) <= 64):
        raise ValueError("Process observation timestamp is invalid")
    memory = value.get("memory")
    if (not isinstance(memory, dict) or not isinstance(memory.get("status"), str) or
            not 1 <= len(memory["status"]) <= 64):
        raise ValueError("Process observation has no memory result")
    point = {"at": value["observed_at"], "monotonic_ns": value["monotonic_ns"],
             "publisher_sequence": value["sequence"],
             "exact_status": memory.get("status"), "tree_status": "unavailable"}
    if memory.get("status") == "original_process":
        private, rss = memory.get("private_bytes"), memory.get("rss_bytes")
        if (memory.get("proc_pid") != process["proc_pid"] or
                type(private) is not int or type(rss) is not int or not 0 <= private <= rss):
            raise ValueError("Original command counters are invalid")
        point["exact_command"] = {"rss_bytes": rss, "private_bytes": private}
        if "tree" in memory:
            try:
                point["tree"] = _observed_tree(memory["tree"], process)
                point["tree_status"] = "observed"
            except (ValueError, KeyError, TypeError):
                point["tree_status"] = "invalid"
    return process, supervisor, point

def _compact_process_frame(value):
    """Keep original resource counters readable when optional detail fills a slot."""
    history = value.get("process_memory")
    if not isinstance(history, dict):
        return _frame(value)
    compact = {key: item for key, item in history.items() if key not in ("latest", "observed_tree")}
    compact["details_compacted"] = True
    compact["observed_tree"] = {key: item for key, item in history.get("observed_tree", {}).items()
                                if not key.endswith("_sample")}
    latest = history.get("latest")
    if isinstance(latest, dict):
        compact["latest"] = {key: item for key, item in latest.items() if key != "tree"}
        if isinstance(latest.get("tree"), dict):
            compact["latest"]["tree"] = {key: item for key, item in latest["tree"].items()
                                          if key not in ("largest_private_processes", "cgroup_path")}
    selected = {**value, "process_memory": compact}
    try:
        return _frame(selected)
    except ValueError:
        selected.pop("process_memory")
        selected["process_memory_omitted_for_space"] = True
        return _frame(selected)


def _compact_history_frame(value):
    """Keep current state writable when retained resource scopes fill a slot."""
    latest = value["recent"][-1] if value["recent"] else {}
    active = {kind: set(latest.get(kind, {})) for kind in ("memory", "filesystems")}
    summary = value["summary"]
    while True:
        try:
            return _compact_process_frame(value)
        except ValueError:
            candidates = [(row.get("last_at", ""), kind, key)
                          for kind in ("memory", "filesystems")
                          for key, row in summary[kind].items()
                          if key not in active[kind]]
            if not candidates and value["recent"]:
                # Optional sample detail yields before summaries of resources
                # observed in this supervisor's current namespace.
                value["recent"].pop(0)
                value["samples_omitted_for_space"] = value.get("samples_omitted_for_space", 0) + 1
                continue
            if not candidates:
                candidates = [(row.get("last_at", ""), kind, key)
                              for kind in ("memory", "filesystems")
                              for key, row in summary[kind].items()]
            if not candidates:
                raise
            _, kind, key = min(candidates)
            row = summary[kind].pop(key)
            compacted = value.setdefault("summary_entries_compacted", {}).setdefault(
                kind, {"entries": 0, "observations": 0})
            compacted["entries"] += 1
            compacted["observations"] += row.get("observations", 0)
            for field, select in (("first_at", min), ("last_at", max)):
                if row.get(field):
                    compacted[field] = select(compacted.get(field, row[field]), row[field])
            # A sample without its scope descriptor would imply unavailable
            # provenance. Remove that entry and retain the explicit omission.
            for point in value["recent"]:
                if key in point.get(kind, {}):
                    del point[kind][key]
                    point["resource_entries_omitted_for_space"] = True


class Recorder:
    def __init__(self, root, request, *, supervisor=None):
        self.root, self.request, self.fd = Path(root), request, None
        self.supervisor = _process_identity(supervisor) if supervisor is not None else None
        self.last_sample = 0.0
        self.value = {**_binding(request), "status": "recording", "sequence": 0,
                      "interval_seconds": INTERVAL_SECONDS, "recent_limit": RECENT_SAMPLES,
                      "summary": {"memory": {}, "filesystems": {}}, "recent": [],
                      "observation_errors": 0, "write_errors": 0}
        storage = request.get("storage", {})
        self.paths = list(dict.fromkeys([request["intent"]["project"], str(self.root),
            *[value for value in storage.values() if isinstance(value, str)],
            *[row["path"] for row in request["intent"].get("disk", {}).get("paths", [])]]))
        self.scope = {"boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                      "mount_namespace": os.readlink("/proc/self/ns/mnt")}
        path = self.root / FILENAME
        created = False
        try:
            flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
            try:
                self.fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o600)
                created = True
                os.posix_fallocate(self.fd, 0, FILE_BYTES)
            except FileExistsError:
                self.fd = os.open(path, flags)
                self.value, _ = _read(self.fd, request)
                reconciliation = self.value.pop("pending_intent_reconciliation", None)
                if reconciliation is not None:
                    self.value.setdefault("original_intent_sha256", self.value["intent_sha256"])
                    self.value["intent_sha256"] = reconciliation["current_intent_sha256"]
                    self.value["intent_reconciliations"] = self.value.get("intent_reconciliations", 0) + 1
                    self.value["last_intent_reconciliation"] = {
                        **reconciliation, "after_sequence": self.value["sequence"]}
                self.value["continuations"] = self.value.get("continuations", 0) + 1
                # A resumed queue retains the prior observed outcome explicitly;
                # it is not the current supervisor's terminal state.
                self.value["status"] = "recording"
                if "outcome" in self.value:
                    self.value["outcome_is_previous"] = True
            self.sample("starting", force=True)
            if created:
                directory = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            self.value.update(status="unavailable", last_error=_error(exc))
            self.close()
            if created:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

    @classmethod
    def open(cls, root, request, *, supervisor=None):
        try:
            return cls(root, request, supervisor=supervisor)
        except (OSError, ValueError, TypeError, KeyError):
            # Passive observation must never prevent an authorized command.
            return None

    def _identity(self, kind, label):
        return hashlib.sha256(_encoded([self.scope, kind, label])).hexdigest()[:20]

    def _project(self, report, phase):
        at = report["finished_at"]
        sample = {"sequence": self.value["sequence"] + 1, "at": at, "phase": phase,
                  "intent_sha256": self.value["intent_sha256"],
                  "memory": {}, "filesystems": {}}
        summary = self.value["summary"]
        host = report["host_memory"].get("available_bytes")
        sample["host_available_bytes"] = host
        _track(summary, "minimum_host_available_bytes", host, at, minimum=True)
        group = report["cgroup_memory"]
        for index, current in enumerate(group.get("levels", [])):
            key = self._identity("cgroup", current["directory"])
            row = summary["memory"].setdefault(key, {"directory": current["directory"],
                "scope": self.scope, "first_at": at, "observations": 0})
            row.update(last_at=at, limit_bytes=current.get("max_bytes"),
                       limit_status=current.get("max_status"), observations=row["observations"] + 1)
            point = {name: current.get(name) for name in ("current_bytes", "headroom_bytes")}
            _track(row, "peak_current_bytes", point["current_bytes"], at)
            _track(row, "minimum_headroom_bytes", point["headroom_bytes"], at, minimum=True)
            if index == 0:
                _counters(row, group.get("events"))
                point["events"] = group.get("events")
                pressure = group.get("pressure", {})
                point["pressure"] = {kind: pressure.get(kind) for kind in ("some", "full")}
                for kind in ("some", "full"):
                    values = pressure.get(kind)
                    if isinstance(values, dict):
                        _counters(row, {kind + "_stall_us": values.get("total_us")})
                row["last_stat_bytes"] = group.get("stat_bytes")
            sample["memory"][key] = point
        for current in report["filesystems"]:
            if current.get("status") != "ok":
                sample.setdefault("unavailable_paths", []).append(current["requested_path"])
                continue
            key = self._identity("filesystem", current["device"])
            if key in sample["filesystems"]:
                continue
            row = summary["filesystems"].setdefault(key, {"device": current["device"],
                "scope": self.scope, "path": current.get("observed_path"),
                "mountpoint": current.get("mountpoint"), "filesystem": current.get("filesystem"),
                "memory_backed": current.get("memory_backed"), "first_at": at, "observations": 0})
            row.update(last_at=at, observations=row["observations"] + 1,
                       available_bytes_source=current.get("available_bytes_source"),
                       caller_identity=current.get("caller_identity"))
            point = {name: current.get(name) for name in ("available_bytes", "inodes_available",
                     "free_including_reserved_bytes", "unprivileged_available_bytes")}
            _track(row, "minimum_available_bytes", point["available_bytes"], at, minimum=True)
            _track(row, "minimum_free_including_reserved_bytes", point["free_including_reserved_bytes"], at, minimum=True)
            _track(row, "minimum_unprivileged_available_bytes", point["unprivileged_available_bytes"], at, minimum=True)
            _track(row, "minimum_inodes_available", point["inodes_available"], at, minimum=True)
            if point["available_bytes"] == 0:
                row["zero_space_observations"] = row.get("zero_space_observations", 0) + 1
            sample["filesystems"][key] = point
        sample["observation_status"] = "partial" if (group.get("status") != "ok" or
            report["host_memory"].get("status") != "ok" or sample.get("unavailable_paths")) else "ok"
        return sample


    def process_sample(self, observation):
        """Retain a fresh value returned by this command's original Publisher.

        No liveness read, process scan, admission credit or filesystem allocation
        occurs here. The existing five-second resource frame carries the result.
        """
        if self.fd is None or observation is None:
            return
        try:
            process, supervisor, point = _process_observation(
                observation, self.root, self.request, self.scope["boot_id"])
            history = self.value.get("process_memory")
            if history is None:
                history = {"schema": PROCESS_SCHEMA, "measurement": "sampled",
                           "source": "original_supervisor_residency",
                           "process": process, "supervisor": supervisor,
                           "observations": 0, "first_at": point["at"],
                           "exact_command": {}, "observed_tree": {}}
                self.value["process_memory"] = history
            if _process_key(history["process"]) != _process_key(process):
                raise ValueError("Preserve the original command lifetime in its history")
            previous = history.get("latest")
            same_publisher = _process_key(history["supervisor"]) == _process_key(supervisor)
            if previous and same_publisher:
                if point["publisher_sequence"] <= previous["publisher_sequence"]:
                    return
                if point["monotonic_ns"] < previous["monotonic_ns"]:
                    raise ValueError("Original publisher clock moved backwards")
                _track(history, "maximum_sample_gap_ns",
                       point["monotonic_ns"] - previous["monotonic_ns"], point["at"])
            history.update(supervisor=supervisor, observations=history["observations"] + 1,
                           last_at=point["at"], latest=point)
            exact = point.get("exact_command")
            if exact is not None:
                summary = history["exact_command"]
                summary["observations"] = summary.get("observations", 0) + 1
                for field in ("rss_bytes", "private_bytes"):
                    _track(summary, "sampled_peak_" + field, exact[field], point["at"])
            else:
                history["unavailable_exact_observations"] = history.get("unavailable_exact_observations", 0) + 1
            tree = point.get("tree")
            if tree is not None:
                summary = history["observed_tree"]
                summary["observations"] = summary.get("observations", 0) + 1
                for field in ("rss_sum_bytes", "private_sum_bytes"):
                    peak = "sampled_peak_" + field
                    if summary.get(peak) is None or tree[field] > summary[peak]:
                        summary[peak + "_sample"] = {"at": point["at"],
                            "publisher_sequence": point["publisher_sequence"], **tree}
                    _track(summary, peak, tree[field], point["at"])
                _track(summary, "maximum_observed_processes", tree["observed_processes"], point["at"])
                if tree["unavailable_processes"] or tree["truncated"]:
                    summary["partial_observations"] = summary.get("partial_observations", 0) + 1
            else:
                history["unavailable_tree_observations"] = history.get("unavailable_tree_observations", 0) + 1
        except (OSError, ValueError, KeyError, TypeError):
            self.value["process_observation_errors"] = self.value.get("process_observation_errors", 0) + 1

    def _supervisor_sample(self, point):
        """Read this original supervisor only; never scan another process tree."""
        if self.supervisor is None:
            return
        try:
            identity = self.supervisor
            raw = Path("/proc/self/stat").read_text()
            tail = raw[raw.rfind(")") + 1:].split()
            if (int(raw.split("(", 1)[0]) != identity["proc_pid"] or
                    tail[19] != identity["start_ticks"] or
                    identity["boot_id"] != self.scope["boot_id"]):
                raise ValueError("Supervisor observation differs from its original identity")
            with Path("/proc/self/status").open() as stream:
                raw_status = stream.read(16385)
            if len(raw_status) > 16384:
                raise ValueError("Supervisor status exceeds its observation limit")
            fields = dict(line.split(":", 1) for line in raw_status.splitlines() if ":" in line)
            values = {}
            for source, target in (("VmRSS", "rss_bytes"), ("RssAnon", "anonymous_rss_bytes"),
                                   ("RssShmem", "shared_rss_bytes"), ("VmHWM", "kernel_peak_rss_bytes")):
                parts = fields.get(source, "").split()
                if not parts:
                    values[target] = None
                elif len(parts) == 2 and parts[0].isdecimal() and parts[1] == "kB":
                    values[target] = int(parts[0]) * 1024
                else:
                    raise ValueError("Supervisor memory counter is invalid")
            history = self.value.setdefault("supervisor_memory", {
                "scope": "original_supervisor_only", "measurement": "sampled_procfs",
                "first_at": point["at"], "observations": 0, "lifetimes_observed": 0})
            previous = history.get("latest", {})
            if previous.get("identity") != identity:
                history["lifetimes_observed"] += 1
            observed = {"at": point["at"], "identity": identity, **values}
            history.update(latest=observed, last_at=point["at"],
                           observations=history["observations"] + 1)
            for field in ("rss_bytes", "anonymous_rss_bytes", "shared_rss_bytes"):
                prior = history.get("sampled_peak_" + field)
                _track(history, "sampled_peak_" + field, values[field], point["at"])
                if type(values[field]) is int and (prior is None or values[field] > prior):
                    history["sampled_peak_" + field + "_identity"] = identity
            point["supervisor_memory"] = observed
        except (OSError, ValueError, KeyError, TypeError, IndexError) as exc:
            self.value["supervisor_observation_errors"] = self.value.get("supervisor_observation_errors", 0) + 1
            point["supervisor_memory_error"] = _error(exc)

    def sample(self, phase, *, force=False, outcome=None):
        if self.fd is None:
            return
        clock = time.monotonic()
        if not force and clock - self.last_sample < INTERVAL_SECONDS:
            return
        self.last_sample = clock
        try:
            if __package__:
                from .worker_capacity import snapshot
            else:
                from worker_capacity import snapshot
            point = self._project(snapshot(self.paths, nearest_existing=True), phase)
            process = self.value.get("process_memory", {}).get("latest")
            if process is not None:
                observation = {key: process[key] for key in
                    ("at", "publisher_sequence", "exact_status", "tree_status")}
                observation["sample_age_ns"] = max(0, time.monotonic_ns() - process["monotonic_ns"])
                if "exact_command" in process:
                    observation["exact_command"] = process["exact_command"]
                if "tree" in process:
                    observation["tree"] = {key: process["tree"][key] for key in
                        ("observed_processes", "measured_processes", "unavailable_processes",
                         "truncated", "rss_sum_bytes", "private_sum_bytes")}
                point["process_memory"] = observation
        except (OSError, ValueError, TypeError, KeyError) as exc:
            self.value["observation_errors"] += 1
            self.value["last_error"] = _error(exc)
            # A fresh counter failure must not discard a known terminal outcome.
            # Preserve older summaries and identify this sample as unavailable.
            point = {"sequence": self.value["sequence"] + 1,
                     "intent_sha256": self.value["intent_sha256"],
                     "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     "phase": phase, "memory": {}, "filesystems": {},
                     "observation_status": "unavailable", "error": _error(exc)}
        self._supervisor_sample(point)
        self.value["sequence"] = point["sequence"]
        self.value.setdefault("first_observed_at", point["at"])
        self.value["last_observed_at"] = point["at"]
        self.value["phase"] = phase
        self.value["recent"] = (self.value["recent"] + [point])[-RECENT_SAMPLES:]
        if outcome is not None:
            self.value["outcome"] = {key: outcome[key] for key in
                ("state", "ended_at", "exit_code", "error", "errno", "error_stage",
                 "persistence_wait", "stop_requested", "result_recorded", "supervisor")
                if key in outcome}
            self.value["outcome_is_previous"] = False
            self.value["status"] = "finished"
        try:
            while True:
                try:
                    frame = _frame(self.value)
                    break
                except ValueError:
                    if len(self.value["recent"]) <= 1:
                        frame = _compact_history_frame(self.value)
                        break
                    del self.value["recent"][0]
            offset = (self.value["sequence"] % 2) * SLOT_BYTES
            written = 0
            while written < len(frame):
                size = os.pwrite(self.fd, frame[written:], offset + written)
                if size <= 0:
                    raise OSError("Resource history write made no progress")
                written += size
            os.fsync(self.fd)
        except (OSError, ValueError, TypeError) as exc:
            self.value["write_errors"] += 1
            self.value["last_error"] = _error(exc)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
