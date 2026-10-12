"""Typed Python access to the original native MPP channel application.

The retained Node client attaches to a running product. Task authority, payment,
merchant work, close and receiving remain in that original application.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from queue import Empty, Full, Queue
import subprocess
from threading import Lock, Thread
from time import monotonic
from typing import Any, Mapping
from uuid import uuid4

SCHEMA = "stellar-forge.mpp-channel-python-bridge.v1"
MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_REPLY_BYTES = 32 * 1024 * 1024
ACTIONS = frozenset({
    "task-template", "task-save", "task-authorize", "task-authority-resume", "task-stop",
    "purchase-prepare", "purchase-execute", "purchase-resume", "purchase-refresh",
    "purchase-cancel", "merchant-save", "merchant-start", "merchant-stop",
    "delivery-recover", "close-prepare", "close-execute", "close-resume",
    "close-reconcile", "close-cancel", "funder-template", "funder-save", "channel-observe", "funding-prepare", "funding-execute", "funding-resume", "funding-reconcile", "funding-cancel", "collection-prepare", "collection-execute", "collection-resume", "collection-reconcile", "collection-cancel",
    "contract-fetch", "export", "receive",
})


class ChannelError(RuntimeError):
    """Retain the original operation and job identity when a call is interrupted."""

    def __init__(
        self, code: str, message: str, *, native: Mapping[str, Any] | None = None,
        method: str | None = None, request_id: str | None = None,
        operation_ids: Mapping[str, str] | None = None, uncertain: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.native = dict(native or {})
        self.method = method
        self.request_id = request_id
        self.operation_ids = dict(operation_ids or {})
        self.job_id = self.native.get("jobId")
        self.uncertain = bool(uncertain or self.native.get("uncertain"))
        self.original_result = self.native.get("originalResult")

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code, "message": str(self), "method": self.method,
            "requestId": self.request_id, "operationIds": self.operation_ids,
            "jobId": self.job_id, "uncertain": self.uncertain,
            "originalResult": self.original_result, "native": self.native,
        }


def _absolute(path: str | os.PathLike[str]) -> str:
    return str(Path(path).expanduser().resolve())


def _operation_ids(method: str, value: Mapping[str, Any]) -> dict[str, str]:
    selected = value.get("arguments") if method == "operate" else value
    if not isinstance(selected, Mapping):
        return {}
    return {
        key: item for key, item in selected.items()
        if key in {"taskId", "purchaseId", "settlementId", "fundingId", "handoverId", "id"}
        and isinstance(item, str)
    }


class ChannelClient:
    """One retained Node attachment to the selected existing product.

    Calls are serial on this client. The original application remains the owner
    of its native workspace and jobs. A transport timeout closes this attachment;
    reopen the product attachment and inspect the same operation or work list.
    """

    def __init__(
        self, product: str | os.PathLike[str], *, node: str = "node",
        timeout: float = 60.0, start_timeout: float = 30.0,
    ) -> None:
        if not isinstance(timeout, (int, float)) or not 1 <= timeout <= 86400:
            raise ValueError("timeout must be between 1 and 86400 seconds")
        if not isinstance(start_timeout, (int, float)) or not 1 <= start_timeout <= 300:
            raise ValueError("start_timeout must be between 1 and 300 seconds")
        if not isinstance(node, str) or not node:
            raise ValueError("select the actual Node executable")
        self.product = _absolute(product)
        self.timeout = float(timeout)
        self._lock = Lock()
        self._closed = False
        self._frames: Queue[dict[str, Any] | BaseException] = Queue(maxsize=4)
        self._stderr = bytearray()
        self._stderr_lock = Lock()
        bridge = Path(__file__).with_name("bridge.mjs")
        if not bridge.is_file():
            raise ChannelError("MPP_CHANNEL_BRIDGE_SOURCE_REQUIRED", "Keep the complete Python source directory together.")
        try:
            self._process = subprocess.Popen(
                [node, str(bridge), "--directory", self.product],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                bufsize=65536, close_fds=True,
            )
        except OSError as error:
            self._closed = True
            raise ChannelError("MPP_CHANNEL_NODE_START_FAILED", "The selected Node bridge could not start.") from error
        self._reader = Thread(target=self._read_stdout, name="mpp-channel-results", daemon=True)
        self._errors = Thread(target=self._read_stderr, name="mpp-channel-stderr", daemon=True)
        self._reader.start()
        self._errors.start()
        try:
            frame = self._next_frame(float(start_timeout))
            if frame.get("type") != "ready" or not isinstance(frame.get("identity"), dict):
                raise self._native_error(frame, method="connect")
            self.connected_identity = dict(frame["identity"])
        except BaseException:
            self._terminate()
            raise

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def stderr_tail(self) -> str:
        """The retained bridge's bounded diagnostics, available to its operator."""
        with self._stderr_lock:
            return bytes(self._stderr).decode("utf-8", errors="replace")

    def _enqueue(self, value: dict[str, Any] | BaseException) -> None:
        try:
            self._frames.put_nowait(value)
        except Full:
            # An unsolicited stream is not a response to this client's current operation.
            if self._process.poll() is None:
                self._process.terminate()

    def _read_stdout(self) -> None:
        stream = self._process.stdout
        assert stream is not None
        try:
            while True:
                line = stream.readline(MAX_REPLY_BYTES + 1)
                if not line:
                    self._enqueue(ChannelError("MPP_CHANNEL_BRIDGE_CLOSED", "The original bridge attachment ended."))
                    return
                if len(line) > MAX_REPLY_BYTES or not line.endswith(b"\n"):
                    self._enqueue(ChannelError("MPP_CHANNEL_BRIDGE_REPLY_LIMIT", "The bridge reply exceeds its framing limit."))
                    return
                frame = json.loads(line.decode("utf-8"))
                if not isinstance(frame, dict) or frame.get("schema") != SCHEMA:
                    raise ValueError("unexpected bridge frame")
                self._enqueue(frame)
        except BaseException:
            self._enqueue(ChannelError("MPP_CHANNEL_BRIDGE_REPLY_INVALID", "The bridge returned an unreadable response."))

    def _read_stderr(self) -> None:
        stream = self._process.stderr
        assert stream is not None
        try:
            while True:
                chunk = stream.read1(4096)
                if not chunk:
                    return
                with self._stderr_lock:
                    self._stderr.extend(chunk)
                    if len(self._stderr) > 65536:
                        del self._stderr[:-65536]
        except OSError:
            return

    def _write_frame(self, wire: bytes, timeout: float) -> None:
        completed: Queue[BaseException | None] = Queue(maxsize=1)

        def write() -> None:
            try:
                assert self._process.stdin is not None
                view = memoryview(wire)
                while view:
                    written = self._process.stdin.write(view)
                    if not written:
                        raise BrokenPipeError()
                    view = view[written:]
                self._process.stdin.flush()
                completed.put_nowait(None)
            except BaseException as error:
                completed.put_nowait(error)

        writer = Thread(target=write, name="mpp-channel-request", daemon=True)
        writer.start()
        try:
            outcome = completed.get(timeout=timeout)
        except Empty as error:
            raise ChannelError("MPP_CHANNEL_BRIDGE_TIMEOUT", "The original bridge did not receive this complete request in time.") from error
        if outcome is not None:
            raise ChannelError("MPP_CHANNEL_BRIDGE_INTERRUPTED", "The original request pipe ended.") from outcome

    def _next_frame(self, timeout: float) -> dict[str, Any]:
        try:
            frame = self._frames.get(timeout=timeout)
        except Empty as error:
            raise ChannelError("MPP_CHANNEL_BRIDGE_TIMEOUT", "Read the original product operation after this attachment timeout.") from error
        if isinstance(frame, BaseException):
            raise frame
        return frame

    @staticmethod
    def _native_error(
        frame: Mapping[str, Any], *, method: str | None = None,
        request_id: str | None = None, operation_ids: Mapping[str, str] | None = None,
    ) -> ChannelError:
        native = frame.get("error")
        if not isinstance(native, Mapping):
            native = {"code": "MPP_CHANNEL_BRIDGE_PROTOCOL_ERROR", "message": "The original bridge response did not match this call."}
        return ChannelError(
            str(native.get("code", "MPP_CHANNEL_BRIDGE_OPERATION_FAILED")),
            str(native.get("message", "The original operation did not complete.")),
            native=native, method=method, request_id=request_id,
            operation_ids=operation_ids, uncertain=bool(native.get("uncertain")),
        )

    def _terminate(self) -> None:
        self._closed = True
        process = self._process
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass
        # Only this private bridge process is stopped. The native product retains its jobs.

    def _call_locked(
        self, method: str, value: Mapping[str, Any], *, timeout: float | None = None,
    ) -> Any:
        if self._closed:
            raise ChannelError("MPP_CHANNEL_CLIENT_CLOSED", "Open an attachment to the original running product.")
        selected_timeout = self.timeout if timeout is None else timeout
        if not isinstance(selected_timeout, (int, float)) or not 1 <= selected_timeout <= 86400:
            raise ValueError("timeout must be between 1 and 86400 seconds")
        request_id = uuid4().hex
        ids = _operation_ids(method, value)
        try:
            wire = (
                json.dumps({"schema": SCHEMA, "id": request_id, "method": method, "input": dict(value)},
                           ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
            ).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise ChannelError("MPP_CHANNEL_INPUT_JSON_REQUIRED", "Use complete JSON-compatible original input.", method=method, operation_ids=ids) from error
        if len(wire) > MAX_REQUEST_BYTES:
            raise ChannelError("MPP_CHANNEL_BRIDGE_REQUEST_LIMIT", "Use run_file for a large original work list.", method=method, operation_ids=ids)
        try:
            deadline = monotonic() + float(selected_timeout)
            self._write_frame(wire, float(selected_timeout))
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise ChannelError("MPP_CHANNEL_BRIDGE_TIMEOUT", "The original request used this attachment's waiting interval.")
            frame = self._next_frame(remaining)
        except (OSError, ChannelError) as error:
            self._terminate()
            raise ChannelError(
                getattr(error, "code", "MPP_CHANNEL_BRIDGE_INTERRUPTED"),
                "This attachment ended before its original reply. Inspect the retained operation or original work list.",
                method=method, request_id=request_id, operation_ids=ids,
                uncertain=method in {"operate", "run"},
            ) from error
        if frame.get("type") != "result" or frame.get("id") != request_id:
            self._terminate()
            raise ChannelError("MPP_CHANNEL_BRIDGE_RESULT_CHANGED", "The reply belongs to a different bridge request.",
                               method=method, request_id=request_id, operation_ids=ids,
                               uncertain=method in {"operate", "run"})
        if frame.get("ok") is not True:
            raise self._native_error(frame, method=method, request_id=request_id, operation_ids=ids)
        return frame.get("result")

    def call(self, method: str, value: Mapping[str, Any] | None = None, *, timeout: float | None = None) -> Any:
        """Call the existing bridge methods; invoke() selects a native application action."""
        with self._lock:
            return self._call_locked(method, value or {}, timeout=timeout)

    def identity(self) -> dict[str, Any]:
        return self.call("identity")

    def state(self) -> dict[str, Any]:
        return self.call("state")

    def record(self, kind: str, identifier: str) -> dict[str, Any]:
        if kind not in {"tasks", "purchases", "contracts", "funders", "funding", "settlements", "observations"}:
            raise ValueError("record kind must be tasks, purchases or contracts")
        return self.call("record", {"kind": kind, "id": identifier})

    def task(self, task_id: str) -> dict[str, Any]:
        return self.record("tasks", task_id)

    def purchase(self, purchase_id: str) -> dict[str, Any]:
        return self.record("purchases", purchase_id)

    def contract(self, profile_id: str) -> dict[str, Any]:
        return self.record("contracts", profile_id)

    def job(self, job_id: str) -> dict[str, Any]:
        return self.call("job", {"id": job_id})

    def invoke(
        self, action: str, arguments: Mapping[str, Any] | None = None, *,
        wait_ms: int = 30000, timeout: float | None = None,
    ) -> dict[str, Any]:
        if action not in ACTIONS:
            raise ValueError("select an original channel action")
        if type(wait_ms) is not int or not 0 <= wait_ms <= 3600000:
            raise ValueError("wait_ms must be an integer from 0 to 3600000")
        return self.call("operate", {"action": action, "arguments": dict(arguments or {}), "waitMs": wait_ms},
                         timeout=timeout if timeout is not None else min(86400, self.timeout + wait_ms / 1000))

    def prepare_purchase(self, task_id: str, purchase_id: str, request: Mapping[str, Any], **options: Any) -> dict[str, Any]:
        return self.invoke("purchase-prepare", {"taskId": task_id, "purchaseId": purchase_id, "request": dict(request)}, **options)

    def execute_purchase(self, purchase_id: str, **options: Any) -> dict[str, Any]:
        return self.invoke("purchase-execute", {"purchaseId": purchase_id}, **options)

    def resume_purchase(self, purchase_id: str, **options: Any) -> dict[str, Any]:
        return self.invoke("purchase-resume", {"purchaseId": purchase_id}, **options)

    def run_purchases(
        self, document: Mapping[str, Any], *, result_path: str | os.PathLike[str] | None = None,
        wait_ms: int = 30000, timeout: float = 600.0,
    ) -> dict[str, Any]:
        value: dict[str, Any] = {"document": dict(document), "waitMs": wait_ms}
        if result_path is not None:
            value["resultPath"] = _absolute(result_path)
        return self.call("run", value, timeout=timeout)

    def run_file(
        self, file: str | os.PathLike[str], *, result_path: str | os.PathLike[str],
        wait_ms: int = 30000, timeout: float = 600.0,
    ) -> dict[str, Any]:
        """Read the complete original work list locally in the retained Node client."""
        return self.call("run", {"file": _absolute(file), "resultPath": _absolute(result_path), "waitMs": wait_ms}, timeout=timeout)

    def receive_response(
        self, purchase_id: str, path: str | os.PathLike[str], *,
        expected_sha256: str | None = None, timeout: float | None = None,
    ) -> dict[str, Any]:
        value = {"id": purchase_id, "path": _absolute(path)}
        if expected_sha256 is not None:
            value["expectedSha256"] = expected_sha256
        return self.call("response-file", value, timeout=timeout)

    def receive_handover(
        self, bundle_sha256: str, path: str | os.PathLike[str], *,
        expected_file_sha256: str | None = None, timeout: float | None = None,
    ) -> dict[str, Any]:
        value = {"id": bundle_sha256, "path": _absolute(path)}
        if expected_file_sha256 is not None:
            value["expectedSha256"] = expected_file_sha256
        return self.call("handover-file", value, timeout=timeout)

    def receive_channel(
        self, file: str | os.PathLike[str], dependency_root: str | os.PathLike[str], **options: Any,
    ) -> dict[str, Any]:
        return self.invoke("receive", {"file": _absolute(file), "dependencyRoot": _absolute(dependency_root)}, **options)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            try:
                self._call_locked("close", {}, timeout=5.0)
                self._process.wait(timeout=2)
            except (ChannelError, OSError, subprocess.TimeoutExpired):
                pass
            finally:
                self._terminate()

    def __enter__(self) -> ChannelClient:
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()
