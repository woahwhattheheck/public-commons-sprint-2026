# SPDX-License-Identifier: MIT
"""Same-request background execution of the original analyst operations."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid

SOURCE = Path(__file__).resolve().parent.parent
CORE_ROOT = SOURCE / "starforge_stac" if (SOURCE / "starforge_stac").is_dir() else SOURCE
# The complete desktop plugin is flat; received and installed source use the canonical package layout.
sys.path[:0] = [str(SOURCE), str(CORE_ROOT.parent)]
from starforge_stac.model import QgisWorkspace, QgisReceivingError, require, utc_now, json_bytes, member
from starforge_stac.analyst_state import AnalystJournal
from analyst.actions import execute, NATIVE_ACTIONS


@contextmanager
def worker_lock(workspace, *, blocking=False):
    require(os.name == "posix", "ANALYST_LOCK_PLATFORM",
            "Run the managed analyst listener on its existing POSIX Python host.")
    import fcntl
    path = member(workspace.root, "analyst/worker.lock", existing=False)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    acquired = False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            acquired = True
        except BlockingIOError:
            pass
        yield fd if acquired else None
    finally:
        if acquired:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def active(workspace):
    with worker_lock(workspace) as lock:
        return lock is None


def error_value(exc):
    return {"code": getattr(exc, "code", type(exc).__name__),
            "message": str(exc), "details": getattr(exc, "details", {})}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--instance-id", required=True)
    args = parser.parse_args(argv)
    workspace = QgisWorkspace(args.workspace)
    journal = AnalystJournal(workspace)
    application = None
    last_progress = 0.0
    previous_handlers = {}
    def interrupted(signum, frame):
        raise InterruptedError("The original listener stopped this owned worker; continue its retained request.")
    for signum in (signal.SIGTERM, signal.SIGINT):
        previous_handlers[signum] = signal.signal(signum, interrupted)
    try:
        with worker_lock(workspace) as lock:
            if lock is None:
                print(json.dumps({"status": "READY", "code": "ANALYST_WORKER_ACTIVE",
                                  "requestId": args.request_id}), flush=True)
                return 75
            record = journal.get(args.request_id)
            if record["status"] == "COMPLETED":
                print(json.dumps({"status": "COMPLETED", "requestId": args.request_id,
                                  "replayed": True}), flush=True)
                return 0
            require(record["input"]["workspaceId"] == workspace.read()["id"],
                    "ANALYST_WORKSPACE_CHANGED", "The original workspace identity changed.")
            journal.begin(args.request_id, instance_id=args.instance_id, pid=os.getpid())
            def progress(value):
                nonlocal last_progress
                now = time.monotonic()
                if now - last_progress >= .35 or value.get("phase", "").endswith("complete"):
                    journal.progress(args.request_id, value)
                    last_progress = now
            try:
                if record["input"]["action"] in NATIVE_ACTIONS:
                    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
                    # Keep the selected native profile, auth database and libpq service environment.
                    # A fresh empty profile would sever an existing QGIS authConfigId.
                    from starforge_stac import qgis_project
                    core = qgis_project.native()
                    prefix = record["input"]["nativeRuntime"].get("prefix_path")
                    if prefix:
                        core.QgsApplication.setPrefixPath(prefix, True)
                    application = core.QgsApplication([], False)
                    application.initQgis()
                result, files = execute(workspace, record, progress)
                journal.finish(args.request_id, result, files)
                print(json.dumps({"status": "COMPLETED", "requestId": args.request_id}), flush=True)
                return 0
            except BaseException as exc:
                was_interrupted = isinstance(exc, (InterruptedError, KeyboardInterrupt, SystemExit))
                value = error_value(exc)
                journal.fail(args.request_id, value, interrupted=was_interrupted)
                print(json.dumps({"status": "INTERRUPTED" if was_interrupted else "FAILED",
                                  "requestId": args.request_id, "error": value},
                                 ensure_ascii=False, allow_nan=False), flush=True)
                return 130 if was_interrupted else 2
    finally:
        if application is not None:
            application.exitQgis()
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())
