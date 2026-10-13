"""Bound the original pygeoprocessing statistics handoff without changing arithmetic.

The selected published function is rebuilt from its exact source AST with two
local substitutions: a bounded channel and a failure-reporting worker target.
Official package files, raster operations and Cython statistics remain unchanged.
"""
from __future__ import annotations

import ast
import contextlib
import copy
import hashlib
import inspect
import logging
from pathlib import Path
import queue
import threading
import time

LOGGER = logging.getLogger(__name__)
SCHEMA = "upstate.native-statistics-handoff/v1"
SOURCE_SHA256 = "a94d1c72de9fcfbeab990f9c8802308cb2f073237cfe3043a7ffdfcadda32cc7"
SOURCE_URI = "https://github.com/natcap/pygeoprocessing/blob/2.4.11/src/pygeoprocessing/geoprocessing.py"
_LOCK = threading.RLock()


class StatisticsWorkerFailure(RuntimeError):
    """The original statistics worker failed while its producer was still active."""


class _StatisticsChannel:
    """Bound input blocks and separate the worker's final response from its input."""
    def __init__(self, timeout, shared_memory, report, capacity=2):
        self.producer = threading.get_ident()
        self.timeout = float(timeout)
        self.shared_memory = bool(shared_memory)
        self.requests = queue.Queue(capacity)
        self.response = queue.Queue(1)
        self.cancelled = threading.Event()
        self.finished = threading.Event()
        self.failure = None
        self.current_ack = None
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)
        self.report = {"capacity_blocks": capacity, "submitted_blocks": 0,
                       "consumed_blocks": 0, "peak_queued_blocks": 0,
                       "peak_queued_bytes": 0, "producer_wait_seconds": 0.0,
                       "shared_memory": self.shared_memory, "state": "running"}
        self.queued_bytes = 0
        report["channels"].append(self.report)

    def _error(self):
        if self.failure is not None:
            error = self.failure
            raise StatisticsWorkerFailure(
                "Original raster statistics worker failed: " + type(error).__name__
                + ": " + str(error)) from error
        if self.cancelled.is_set():
            raise StatisticsWorkerFailure("Raster statistics handoff was cancelled")

    def _deadline(self, timeout):
        value = self.timeout if timeout is None else float(timeout)
        if value <= 0:
            return time.monotonic()
        return time.monotonic() + value

    def _acknowledge(self):
        if self.current_ack is not None:
            self.current_ack.set()
            self.current_ack = None

    def put(self, payload, block=True, timeout=None):
        if threading.get_ident() != self.producer:
            # The original Cython worker publishes exactly one final result.
            self.response.put_nowait(payload)
            return
        if payload is None:
            # Original raster_calculator calls this only during interrupted cleanup.
            with self.changed:
                self.cancelled.set()
                self.report["state"] = "cancelled" if self.failure is None else "failed"
                while True:
                    try:
                        _, size, ack = self.requests.get_nowait()
                        self.queued_bytes -= size
                        ack.set()
                    except queue.Empty:
                        break
                self.changed.notify_all()
            return
        size = int(getattr(payload, "nbytes", 0))
        if self.shared_memory and isinstance(payload, tuple):
            size = int(getattr(payload[2], "size", 0))
        ack = threading.Event()
        deadline = self._deadline(timeout)
        started = time.monotonic()
        with self.changed:
            while True:
                self._error()
                if self.finished.is_set():
                    raise StatisticsWorkerFailure("Original statistics worker ended before its input")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise StatisticsWorkerFailure("Timed out handing a block to the original statistics worker")
                try:
                    self.requests.put_nowait((payload, size, ack))
                except queue.Full:
                    if not block:
                        raise
                    self.changed.wait(remaining)
                    continue
                self.queued_bytes += size
                count = self.requests.qsize()
                self.report["submitted_blocks"] += 1
                self.report["peak_queued_blocks"] = max(self.report["peak_queued_blocks"], count)
                self.report["peak_queued_bytes"] = max(self.report["peak_queued_bytes"], self.queued_bytes)
                self.changed.notify_all()
                break
        if self.shared_memory:
            # Do not let the producer overwrite the shared buffer while Cython is
            # still consuming it. The next get or worker completion acknowledges.
            while not ack.wait(min(0.02, max(0.0, deadline - time.monotonic()))):
                self._error()
                if time.monotonic() >= deadline:
                    raise StatisticsWorkerFailure("Timed out waiting for the original shared statistics block")
        self.report["producer_wait_seconds"] += time.monotonic() - started

    def get(self, block=True, timeout=None):
        if threading.get_ident() == self.producer:
            self._error()
            deadline = self._deadline(timeout)
            while True:
                self._error()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise StatisticsWorkerFailure("Original statistics worker returned no result")
                try:
                    return self.response.get(block=block, timeout=min(0.05, remaining) if block else None)
                except queue.Empty:
                    if not block:
                        raise
                    if self.finished.is_set():
                        self._error()
                        # The worker may have published after our timed get
                        # expired but before its completion became visible.
                        try:
                            return self.response.get_nowait()
                        except queue.Empty:
                            raise StatisticsWorkerFailure(
                                "Original statistics worker ended without a result") from None
        self._acknowledge()
        with self.changed:
            while True:
                if self.cancelled.is_set():
                    return None
                try:
                    payload, size, ack = self.requests.get_nowait()
                except queue.Empty:
                    if not block:
                        raise
                    self.changed.wait()
                    continue
                self.queued_bytes -= size
                self.report["consumed_blocks"] += 1
                self.current_ack = ack
                self.changed.notify_all()
                return payload

    def worker_finished(self, failure=None):
        with self.changed:
            self.failure = failure
            self._acknowledge()
            self.report["state"] = "failed" if failure is not None else (
                "cancelled" if self.cancelled.is_set() else "complete")
            if failure is not None:
                self.report["error"] = {"type": type(failure).__name__, "message": str(failure)}
            self.finished.set()
            self.changed.notify_all()


def _run_statistics_worker(channel, expected_blocks, original_worker):
    failure = None
    try:
        original_worker(channel, expected_blocks)
    except BaseException as error:
        failure = error
    finally:
        channel.worker_finished(failure)


def _patched_calculator(implementation, report):
    path = Path(inspect.getsourcefile(implementation))
    body = path.read_bytes()
    source_sha256 = hashlib.sha256(body).hexdigest()
    report["dependency"] = {"source_uri": SOURCE_URI, "source_sha256": source_sha256,
                            "filename": path.name}
    if source_sha256 != SOURCE_SHA256:
        report.update(mode="original_unmodified",
                      reason="This dependency source edition has no selected handoff transformation")
        return None
    parsed = ast.parse(body, filename=str(path))
    matches = [node for node in parsed.body if isinstance(node, ast.FunctionDef)
               and node.name == "raster_calculator"]
    if len(matches) != 1:
        raise ValueError("Selected original raster_calculator definition differs")
    function = copy.deepcopy(matches[0])
    changed_channel = changed_worker = 0
    for node in ast.walk(function):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id == "stats_worker_queue"
                and isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Attribute)
                and isinstance(node.value.func.value, ast.Name)
                and node.value.func.value.id == "queue" and node.value.func.attr == "Queue"
                and not node.value.args and not node.value.keywords):
            node.value = ast.Call(func=ast.Name(id="_upstate_statistics_channel", ctx=ast.Load()),
                                  args=[ast.Name(id="max_timeout", ctx=ast.Load()),
                                        ast.Name(id="use_shared_memory", ctx=ast.Load())],
                                  keywords=[])
            changed_channel += 1
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "threading" and node.func.attr == "Thread"):
            keywords = {item.arg: item for item in node.keywords}
            target, arguments = keywords.get("target"), keywords.get("args")
            if (target is not None and isinstance(target.value, ast.Attribute)
                    and isinstance(target.value.value, ast.Name)
                    and target.value.value.id == "geoprocessing_core"
                    and target.value.attr == "stats_worker"
                    and arguments is not None and isinstance(arguments.value, ast.Tuple)
                    and len(arguments.value.elts) == 2):
                original = target.value
                target.value = ast.Name(id="_upstate_statistics_worker", ctx=ast.Load())
                arguments.value.elts.append(original)
                changed_worker += 1
    if (changed_channel, changed_worker) != (1, 1):
        raise ValueError("Selected original statistics handoff guards differ")
    module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    namespace = dict(implementation.__dict__)
    namespace["_upstate_statistics_channel"] = (
        lambda timeout, shared: _StatisticsChannel(timeout, shared, report))
    namespace["_upstate_statistics_worker"] = _run_statistics_worker
    exec(compile(module, str(path), "exec"), namespace)
    report.update(mode="bounded_original_statistics", substitutions=2)
    return namespace["raster_calculator"]


@contextlib.contextmanager
def bounded_raster_statistics():
    """Apply the selected handoff only during one synchronous native calculation."""
    import pygeoprocessing
    from pygeoprocessing import geoprocessing
    report = {"schema": SCHEMA, "channels": [],
              "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "numerics": "Original raster arithmetic and Cython FIFO statistics worker"}
    with _LOCK:
        original_public = pygeoprocessing.raster_calculator
        original_internal = geoprocessing.raster_calculator
        selected = _patched_calculator(geoprocessing, report)
        if selected is not None:
            pygeoprocessing.raster_calculator = selected
            geoprocessing.raster_calculator = selected
        try:
            yield report
        finally:
            if selected is not None:
                pygeoprocessing.raster_calculator = original_public
                geoprocessing.raster_calculator = original_internal
            report["calculations"] = len(report["channels"])
            report["submitted_blocks"] = sum(row["submitted_blocks"] for row in report["channels"])
            report["peak_queued_bytes_per_calculation"] = max(
                (row["peak_queued_bytes"] for row in report["channels"]), default=0)
            LOGGER.info("Native statistics handoff %s, %s calculations, peak queued %s bytes",
                        report["mode"], report["calculations"],
                        report["peak_queued_bytes_per_calculation"])
