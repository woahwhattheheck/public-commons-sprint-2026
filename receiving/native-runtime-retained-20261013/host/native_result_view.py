"""Bounded CLI view of an original native command and its retained log."""
from __future__ import annotations

import os
from pathlib import Path
import stat

SCHEMA = "commons.native-command-summary/v1"


def compact(report, *, tail_bytes=4096):
    fields = ("operation_id", "state", "exit_code", "error", "error_type", "error_stage", "errno",
              "started_at", "ended_at", "record", "log", "supervisor_alive", "process_alive",
              "reused", "resumed", "finalized", "next_log_offset", "stop_requested", "stop_state",
              "cancelled_before_dispatch", "supervisor_lock_held", "legacy_queue_gate_unresolved")
    value = {"schema": SCHEMA, **{key: report[key][:2048] if isinstance(report[key], str) else report[key]
                                for key in fields if key in report}}
    for name in ("memory_admission", "disk_admission"):
        source = report.get(name)
        if isinstance(source, dict):
            value[name] = {key: source[key] for key in ("state", "reason", "sequence", "sampled_at", "observed_at")
                           if key in source}
    cancellation = report.get("cancellation")
    if isinstance(cancellation, dict):
        value["cancellation"] = {key: cancellation[key] for key in ("boundary", "request_sha256")
                                 if key in cancellation}
    release = report.get("stop_release")
    if isinstance(release, dict):
        value["stop_release"] = {key: release[key] for key in ("ok", "observed_at", "resources")
                                  if key in release}
    artifacts = report.get("artifacts")
    if isinstance(artifacts, dict):
        value["artifacts"] = {key: artifacts[key] for key in ("manifest", "files", "bytes")
                              if key in artifacts and not isinstance(artifacts[key], list)}
        errors = artifacts.get("errors") or []
        value["artifacts"].update(error_count=len(errors), errors=[
            {key: str(row[key])[:512] if isinstance(row[key], str) else row[key]
             for key in ("path", "error", "error_type", "errno") if key in row}
            for row in errors[:5]])
        retention = artifacts.get("retention")
        if isinstance(retention, dict):
            value["artifacts"]["retention"] = {key: retention[key] for key in
                ("state", "files", "bytes", "snapshot") if key in retention}
    if isinstance(report.get("checkpoints"), dict):
        value["checkpoints"] = {key: report["checkpoints"][key] for key in ("count", "directory")
                                if key in report["checkpoints"]}
    if isinstance(report.get("deliveries"), dict):
        value["deliveries"] = {key: report["deliveries"][key] for key in
            ("count", "completed", "pending", "complete", "directory") if key in report["deliveries"]}
    for name in ("runtime_handoff", "failure_recovery"):
        source = report.get(name)
        if isinstance(source, dict):
            value[name] = {key: source[key] for key in
                           ("handoff_id", "phase", "runtime_sha256", "can_recover", "failure_sha256", "state")
                           if key in source}
    if report.get("record"):
        root = Path(report["record"])
        value["records"] = ["request.json", "state.json", "result.json", "artifacts.json", "command-completion.dat"]
        path = root / "output.log"
        if report.get("log") == str(path) and type(tail_bytes) is int and 0 <= tail_bytes <= 16384:
            try:
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    info = os.fstat(descriptor)
                    if stat.S_ISREG(info.st_mode):
                        offset = max(0, info.st_size - tail_bytes)
                        data = os.pread(descriptor, tail_bytes, offset)
                        value.update(log_bytes=info.st_size, log_tail_offset=offset,
                                     log_tail=data.decode("utf-8", errors="replace"))
                finally:
                    os.close(descriptor)
            except FileNotFoundError:
                pass  # The original supervisor creates this file at dispatch.
            except OSError as exc:
                value["log_error"] = type(exc).__name__
    return value


def select(report, mode="full"):
    if mode not in ("full", "summary"):
        raise ValueError("Select full or summary native reporting")
    return compact(report) if mode == "summary" else report
