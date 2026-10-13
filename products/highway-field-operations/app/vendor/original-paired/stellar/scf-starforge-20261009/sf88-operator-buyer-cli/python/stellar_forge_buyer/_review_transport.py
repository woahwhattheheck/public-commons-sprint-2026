"""One owned Node process; the original library owns all durable application state."""
from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import threading
import time
import uuid
from typing import Any

from .errors import NativeError, StateError
from .storage import parse

SCHEMA = "stellar-forge.sf88.python-review.v1"
BRIDGE = Path("stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/review-bridge.mjs")
MAX_FRAME = 8 * 1024 * 1024


class ReviewError(NativeError):
    """A lost response preserves dispatch and operation identity for explicit recovery."""
    def __init__(self, code: str, *, action=None, request_id=None, operation_id=None,
                 dispatched=False, result=None, status=None, returncode=None):
        self.action = action
        self.request_id = request_id
        self.operation_id = operation_id
        self.dispatched = dispatched
        self.result = result
        self.status = status
        super().__init__(code, returncode=returncode, operation=operation_id)


def absolute(value) -> str:
    path = os.fspath(value)
    if not isinstance(path, str) or not os.path.isabs(path) or "\0" in path:
        raise StateError("REVIEW_ABSOLUTE_PATH_REQUIRED")
    return os.path.normpath(path)


class ReviewTransport:
    def __init__(self, *, checkout, configuration, node="node", timeout=360.0,
                 environment=None, response_limit=MAX_FRAME):
        if os.name != "posix":
            raise StateError("REVIEW_POSIX_RUNTIME_REQUIRED")
        self.checkout = Path(absolute(checkout))
        self.node = shutil.which(os.fspath(node))
        entry = self.checkout / BRIDGE
        if not self.node or not entry.is_file():
            raise StateError("ORIGINAL_REVIEW_RUNTIME_REQUIRED")
        if not isinstance(timeout, (int, float)) or not 1 <= timeout <= 86400:
            raise StateError("REVIEW_TIMEOUT_INVALID")
        if type(response_limit) is not int or not 8192 <= response_limit <= MAX_FRAME:
            raise StateError("REVIEW_RESPONSE_LIMIT_INVALID")
        self.timeout = float(timeout)
        self.response_limit = response_limit
        self._closed = False
        self._lock = threading.RLock()
        self._out = bytearray()
        self._diagnostics = bytearray()
        env = None if environment is None else {**os.environ, **dict(environment)}
        try:
            self.process = subprocess.Popen([self.node, str(entry)], cwd=self.checkout,
                env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                shell=False, bufsize=0)
        except OSError:
            raise ReviewError("REVIEW_PROCESS_START_FAILED") from None
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            os.set_blocking(stream.fileno(), False)
        try:
            self.opened = self.call("open", configuration)
        except BaseException:
            self._stop()
            raise

    @property
    def pid(self) -> int:
        return self.process.pid

    def call(self, action: str, parameters=None, *, timeout=None, cancel_event=None) -> Any:
        if cancel_event is not None and not isinstance(cancel_event, threading.Event):
            raise StateError("REVIEW_CANCEL_EVENT_INVALID")
        if cancel_event is not None and cancel_event.is_set():
            raise ReviewError("REVIEW_CANCELLED_BEFORE_DISPATCH", action=action)
        with self._lock:
            if self._closed:
                raise ReviewError("REVIEW_SESSION_CLOSED", action=action)
            return self._exchange(action, parameters or {}, timeout, cancel_event)

    def _exchange(self, action, parameters, timeout, cancel_event):
        duration = self.timeout if timeout is None else timeout
        if not isinstance(duration, (int, float)) or not 0 < duration <= 86400:
            raise StateError("REVIEW_TIMEOUT_INVALID")
        request_id = str(uuid.uuid4())
        if not isinstance(parameters, dict):
            raise StateError("REVIEW_PARAMETERS_INVALID")
        nested = [value for value in (parameters.get("input"), parameters.get("options")) if isinstance(value, dict)]
        operation_id = parameters.get("operationId") or next((value.get("operationId") for value in nested if value.get("operationId")), None)
        try:
            pending = bytearray((json.dumps({"schema": SCHEMA, "id": request_id,
                "action": action, "parameters": parameters}, ensure_ascii=False,
                allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8"))
        except (ValueError, TypeError, UnicodeError):
            raise StateError("REVIEW_PARAMETERS_INVALID") from None
        if len(pending) > MAX_FRAME:
            raise StateError("REVIEW_REQUEST_TOO_LARGE")
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(self.process.stderr, selectors.EVENT_READ, "stderr")
        selector.register(self.process.stdin, selectors.EVENT_WRITE, "stdin")
        deadline = time.monotonic() + duration
        cancel_reason = None
        drain_deadline = None
        dispatched = False
        output_ended = False

        def failure(code, *, result=None, status=None):
            return ReviewError(code, action=action, request_id=request_id,
                operation_id=operation_id, dispatched=dispatched, result=result,
                status=status, returncode=self.process.poll())

        def cancel(reason):
            nonlocal cancel_reason, drain_deadline
            if cancel_reason is not None:
                return
            cancel_reason = reason
            drain_deadline = time.monotonic() + 10
            pending.extend((json.dumps({"cancel": request_id}) + "\n").encode())
            try:
                selector.get_key(self.process.stdin)
            except KeyError:
                selector.register(self.process.stdin, selectors.EVENT_WRITE, "stdin")

        try:
            while True:
                while b"\n" in self._out:
                    line, _, rest = self._out.partition(b"\n")
                    self._out = bytearray(rest)
                    if len(line) > self.response_limit:
                        self._stop()
                        raise failure("REVIEW_RESPONSE_TOO_LARGE")
                    try:
                        response = parse(bytes(line))
                    except (StateError, TypeError):
                        self._stop()
                        raise failure("REVIEW_PROTOCOL_INVALID") from None
                    if not isinstance(response, dict) or response.get("schema") != SCHEMA or response.get("id") != request_id:
                        self._stop()
                        raise failure("REVIEW_RESPONSE_ID_MISMATCH")
                    if response.get("ok") is not True:
                        error = response.get("error", {})
                        raise failure(error.get("code", "REVIEW_NATIVE_FAILED"), status=error.get("status"))
                    if cancel_reason:
                        raise failure(cancel_reason, result=response.get("result"))
                    return response.get("result")
                if len(self._out) > self.response_limit:
                    self._stop()
                    raise failure("REVIEW_RESPONSE_TOO_LARGE")
                now = time.monotonic()
                if cancel_event is not None and cancel_event.is_set():
                    cancel("REVIEW_CANCELLED")
                if now >= deadline:
                    cancel("REVIEW_TIMEOUT")
                if drain_deadline is not None and now >= drain_deadline:
                    self._stop()
                    raise failure(cancel_reason)
                if output_ended:
                    self._stop()
                    raise failure("REVIEW_PROCESS_ENDED")
                try:
                    events = selector.select(0.05)
                    for key, _ in events:
                        if key.data == "stdin":
                            try:
                                sent = os.write(key.fd, pending[:65536])
                            except BlockingIOError:
                                continue
                            except (BrokenPipeError, OSError):
                                self._stop()
                                raise failure("REVIEW_PROCESS_ENDED") from None
                            dispatched = dispatched or sent > 0
                            del pending[:sent]
                            if not pending:
                                selector.unregister(self.process.stdin)
                            continue
                        try:
                            chunk = os.read(key.fd, 65536)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            if key.data == "stdout":
                                output_ended = True
                            continue
                        if key.data == "stdout":
                            self._out.extend(chunk)
                        else:
                            self._diagnostics.extend(chunk)
                            del self._diagnostics[:-65536]
                except KeyboardInterrupt:
                    cancel("REVIEW_INTERRUPTED")
        finally:
            selector.close()

    def close(self):
        with self._lock:
            if self._closed:
                return
            if self.process.poll() is not None:
                self._stop()
                return
            try:
                self.call("close", timeout=30)
            finally:
                self._stop()

    def _stop(self):
        if self._closed:
            return
        self._closed = True
        try:
            self.process.stdin.close()
        except OSError:
            pass
        if self.process.poll() is None:
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        for stream in (self.process.stdout, self.process.stderr):
            stream.close()
