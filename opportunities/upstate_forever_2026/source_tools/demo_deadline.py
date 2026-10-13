"""The original 13 October demo's explicit UTC cutoff and checkpoint.

This guards the existing CLI process. It starts no worker, signals no other
process and never changes a native selection or completed scientific output.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import signal
import threading

CUTOFF = datetime(2026, 10, 13, 14, 0, tzinfo=timezone.utc)
OPERATION = "UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z"


class DemoDeadlineReached(KeyboardInterrupt):
    """The requested sprint cutoff interrupts the same original operation."""


def check_cutoff():
    if datetime.now(timezone.utc) >= CUTOFF:
        raise DemoDeadlineReached("The requested demo cutoff is 2026-10-13 14:00 UTC")


@contextmanager
def cutoff_guard():
    """Interrupt native work in the original main thread at the actual cutoff."""
    check_cutoff()
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError("Run the cutoff-controlled demo in its original main process")
    if not hasattr(signal, "setitimer"):
        raise RuntimeError("The demo cutoff requires the selected Linux native process")
    if any(signal.getitimer(signal.ITIMER_REAL)):
        raise RuntimeError("Compose the existing process timer before starting this demo")
    previous_alarm = signal.getsignal(signal.SIGALRM)
    previous_term = signal.getsignal(signal.SIGTERM)

    def deadline(signum, frame):
        raise DemoDeadlineReached("The requested demo cutoff is 2026-10-13 14:00 UTC")

    def terminate(signum, frame):
        if callable(previous_term):
            previous_term(signum, frame)
        raise KeyboardInterrupt("The original demo process received SIGTERM")

    alarm_installed = term_installed = timer_installed = False
    try:
        signal.signal(signal.SIGALRM, deadline)
        alarm_installed = True
        if previous_term != signal.SIG_IGN:
            signal.signal(signal.SIGTERM, terminate)
            term_installed = True
        remaining = (CUTOFF - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            deadline(signal.SIGALRM, None)
        signal.setitimer(signal.ITIMER_REAL, remaining)
        timer_installed = True
        yield
    finally:
        try:
            if timer_installed:
                signal.setitimer(signal.ITIMER_REAL, 0)
        finally:
            try:
                if alarm_installed:
                    signal.signal(signal.SIGALRM, previous_alarm)
            finally:
                if term_installed:
                    signal.signal(signal.SIGTERM, previous_term)


def retain_checkpoint(output, workspace, error):
    """Save the interruption alongside original receipts without rewriting results."""
    from model.common import atomic_json

    output, workspace = Path(output).resolve(), Path(workspace).resolve()
    receipt_path = output / "demo-receiving.json"
    original = {}
    read_error = None
    if receipt_path.is_file():
        try:
            original = json.loads(receipt_path.read_text(encoding="utf-8"))
            if (original.get("operation") != OPERATION
                    or Path(original.get("workspace", "")).resolve() != workspace):
                original = {}
                read_error = "The retained receipt belongs to another operation or Workspace"
        except (OSError, ValueError, TypeError) as exc:
            original = {}
            read_error = type(exc).__name__ + ": " + str(exc)
    stamp = datetime.now(timezone.utc).isoformat()
    names = ("project_id", "recipe_sha256", "source_collection_id", "profile_id",
             "grid_id", "baseline_scenario_id", "alternative_scenario_ids",
             "baseline_run_id", "alternative_run_ids", "scenario_footprint_ids",
             "comparison_id", "native_process_report_id", "delivery_id",
             "spatial_review_id", "spatial_review_ids", "fieldwork_operation_id",
             "ensemble_id", "archive_edition_id", "backup", "restored")
    checkpoint = {
        "schema": "upstate.simulated-demo-checkpoint/v1",
        "operation": OPERATION, "cutoff": CUTOFF.isoformat(), "stopped_at": stamp,
        "state": "cutoff" if isinstance(error, DemoDeadlineReached) else "interrupted",
        "workspace": str(workspace), "output": str(output),
        "source_receipt": str(receipt_path) if receipt_path.exists() else None,
        "recorded_state": original.get("state"),
        "active_stage": original.get("active_stage"),
        "error": {"type": type(error).__name__, "message": str(error)},
        "retained_selection": {name: original[name] for name in names if name in original},
        "completed_stages": [
            name for name, value in original.get("stages", {}).items()
            if value.get("state") == "complete"],
        "automatic_resume": False,
        "continuation": ("Await an explicit new request. Continue the original Workspace "
                         "and demo-receiving.json to reuse its completed native stages."),
    }
    if read_error:
        checkpoint["receipt_read_error"] = read_error
    atomic_json(output / "demo-checkpoint.json", checkpoint)
    return checkpoint
