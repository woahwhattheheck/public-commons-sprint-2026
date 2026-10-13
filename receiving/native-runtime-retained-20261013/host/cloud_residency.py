"""Original-supervisor memory observations for namespace-separated consumers.

Only the owning supervisor samples its exact native command and descendants. A reconnecting
admission process can consume a fresh identity-bound observation when procfs
denies its own direct smaps read. Each child keeps its native identity and live
ancestry; shared mappings receive no private-page credit. Missing, old or
invalid observations retain zero credit.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import time

if __package__:
    from . import swarm_cloud_job as native
else:
    import swarm_cloud_job as native

SCHEMA = "commons.native-process-residency/v1"
FILENAME = "residency.json"
SAMPLE_INTERVAL_SECONDS = 0.5
MAX_AGE_SECONDS = 1.0
MAX_RECORD_BYTES = 256 * 1024
IDENTITY_KEYS = ("proc_pid", "pid", "start_ticks", "pgid", "boot_id")


def _same(left, right):
    return (isinstance(left, dict) and isinstance(right, dict)
            and all(left.get(key) == right.get(key) for key in IDENTITY_KEYS)
            and (not left.get("namespace") or not right.get("namespace")
                 or left["namespace"] == right["namespace"]))


def _request_hash(request):
    return hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def _rss(identity):
    """Current RSS is only a cap on retained private pages, never a substitute."""
    with (Path("/proc") / str(identity["proc_pid"]) / "status").open() as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("process status exceeds the observation limit")
    fields = dict(line.split(":", 1) for line in raw.splitlines() if ":" in line)
    if int(fields["Pid"].strip()) != identity["proc_pid"]:
        raise ValueError("process status identity differs")
    number, unit = fields["VmRSS"].split()
    if unit != "kB" or not number.isdecimal():
        raise ValueError("invalid current process RSS")
    return int(number) * 1024


class Publisher:
    """A lightweight hook in the existing native supervisor's wait loop."""

    def __init__(self, root, request, supervisor, process, resident):
        self.root = Path(root).resolve()
        self.operation_id = request["intent"]["operation_id"]
        self.request_sha256 = _request_hash(request)
        self.supervisor = supervisor
        self.process = process
        self.resident = resident
        self.next_sample = 0.0
        self.sequence = 0

    def sample(self, *, force=False):
        current = time.monotonic()
        if not force and current < self.next_sample:
            return
        self.next_sample = current + SAMPLE_INTERVAL_SECONDS
        try:
            # An observer in a different execution session cannot publish on
            # another supervisor's behalf. It can only read that owner's file.
            own = native.process_identity(os.getpid())
            if not _same(own, self.supervisor):
                return
            sampled_ns = time.monotonic_ns()
            memory = self.resident(self.process)
            self.sequence += 1
            value = {"schema": SCHEMA, "record": str(self.root),
                     "operation_id": self.operation_id,
                     "request_sha256": self.request_sha256,
                     "supervisor": self.supervisor, "process": self.process,
                     "observed_at": native.now(), "monotonic_ns": sampled_ns,
                     "sequence": self.sequence, "memory": memory,
                     "scope": "exact_original_command"}
        except (OSError, ValueError, KeyError, TypeError):
            # Optional accounting must not turn a real command into a failed
            # operation. The reader expires the preceding sample naturally.
            return
        try:
            native.save_json(self.root / FILENAME, value)
        except (OSError, ValueError, KeyError, TypeError):
            # The existing preallocated resource history can retain this same
            # owned sample even when replacing residency.json cannot allocate.
            pass
        return value


def retained(root, request, supervisor, process):
    """Return usable private-page credit, or None to preserve the direct result."""
    try:
        root = Path(root).resolve()
        with (root / FILENAME).open("rb") as stream:
            raw = stream.read(MAX_RECORD_BYTES + 1)
        if len(raw) > MAX_RECORD_BYTES:
            return None
        value = json.loads(raw)
        if not isinstance(value, dict):
            return None
        if (value.get("schema") != SCHEMA or value.get("record") != str(root)
                or value.get("operation_id") != request["intent"]["operation_id"]
                or value.get("request_sha256") != _request_hash(request)
                or value.get("scope") != "exact_original_command"
                or not _same(value.get("supervisor"), supervisor)
                or not _same(value.get("process"), process)
                or not native.alive(supervisor) or not native.alive(process)):
            return None
        sampled = value.get("monotonic_ns")
        if type(sampled) is not int:
            return None
        age = (time.monotonic_ns() - sampled) / 1_000_000_000
        if not 0 <= age <= MAX_AGE_SECONDS:
            return None
        memory = value.get("memory", {})
        if not isinstance(memory, dict):
            return None
        private, rss = memory.get("private_bytes"), memory.get("rss_bytes")
        if (memory.get("status") != "original_process"
                or memory.get("proc_pid") != process["proc_pid"]
                or type(private) is not int or type(rss) is not int
                or not 0 <= private <= rss):
            return None
        current_rss = _rss(process)
        tree = None
        if "tree" in memory:
            if __package__:
                from .cloud_memory import _validated_tree
            else:
                from cloud_memory import _validated_tree
            tree = _validated_tree(process, memory["tree"], _rss)
        if not native.alive(supervisor) or not native.alive(process):
            return None
        age = (time.monotonic_ns() - sampled) / 1_000_000_000
        if not 0 <= age <= MAX_AGE_SECONDS:
            return None
        return {"status": "original_supervisor_observation",
                "rss_bytes": current_rss, "private_bytes": min(private, current_rss),
                "proc_pid": process["proc_pid"],
                "sample_private_bytes": private, "sample_rss_bytes": rss,
                "sample_age_seconds": age, "observed_at": value["observed_at"],
                "sequence": value.get("sequence"), "source": str(root / FILENAME),
                **({"tree": tree} if tree else {})}
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        return None
