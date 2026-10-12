"""Read/export the original SF88 Inbox through the maintained Node runtime.

This view creates no queue, operation, payment journal or scheduler. A saved
Operations handoff is a private source edition; receiving is a separate review.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re

from .errors import NativeError, StateError
from .runtime import Runtime

_MODE = "ORIGINAL_PYTHON_INBOX"
_MAX_VERIFY_BYTES = 1_073_741_824
_MAX_INTENTS = 100


def _absolute(value):
    try:
        path = os.fspath(value)
    except TypeError:
        raise StateError("BUYER_HANDOFF_ABSOLUTE_PATH_REQUIRED") from None
    if not isinstance(path, str) or "\0" in path:
        raise StateError("BUYER_HANDOFF_ABSOLUTE_PATH_REQUIRED")
    path = os.path.expanduser(path)
    if not os.path.isabs(path) or os.path.abspath(path) != path:
        raise StateError("BUYER_HANDOFF_ABSOLUTE_PATH_REQUIRED")
    return path


def _intent(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value):
        raise StateError("STABLE_INTENT_ID_REQUIRED")
    return value


@dataclass(frozen=True)
class InboxResult:
    """Original native fields and this read/export process outcome, kept separate."""
    native: dict
    process: dict


class InboxError(NativeError):
    """An uncertain export keeps its explicit destination available for inspection."""
    def __init__(self, code, *, result=None, directory=None, destination=None):
        self.result = result
        self.inbox_directory = directory
        self.destination = destination
        super().__init__(code, returncode=result.process["returncode"] if result else None)


class Inbox:
    """Read-only view over an existing native Inbox and its original saved outcomes."""

    def __init__(self, *, checkout, directory, node="node", environment=None,
                 timeout=360, output_limit=16_777_216):
        self.directory = _absolute(directory)
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=output_limit)

    @classmethod
    def from_buyer(cls, buyer, directory):
        """Reuse the Buyer's selected original checkout, runtime and environment."""
        runtime = buyer.runtime
        return cls(checkout=runtime.checkout, directory=directory, node=runtime.node,
                   environment=runtime.environment, timeout=runtime.timeout)

    def _command(self, action, arguments, *, destination=None, cancel_event=None):
        try:
            run = self.runtime.run([action, *arguments], target="application",
                                   cancel_event=cancel_event)
        except (NativeError, StateError) as error:
            raise InboxError(error.code, directory=self.directory,
                             destination=destination) from error
        value = run.output
        result = InboxResult(
            native=value if isinstance(value, dict) else {},
            process={"returncode": run.returncode, "error": run.error,
                     "interrupted": run.interrupted},
        )
        if (run.returncode != 0 or run.error or not isinstance(value, dict)
                or value.get("mode") != _MODE or value.get("action") != action
                or value.get("noExecution") is not True):
            raise InboxError(run.error or "ORIGINAL_INBOX_RESULT_UNAVAILABLE", result=result,
                             directory=self.directory, destination=destination)
        if action != "inbox-inspect-operations" and value.get("root") != self.directory:
            raise InboxError("ORIGINAL_INBOX_ROOT_MISMATCH", result=result,
                             directory=self.directory, destination=destination)
        if destination is not None and value.get("path") != destination:
            raise InboxError("ORIGINAL_HANDOFF_DESTINATION_MISMATCH", result=result,
                             directory=self.directory, destination=destination)
        return result

    def list(self, *, cancel_event=None):
        """Read every existing job; original unattempted/failed/unknown states remain."""
        return self._command("inbox-list", ["--inbox", self.directory], cancel_event=cancel_event)

    def show(self, intent_id, *, cancel_event=None):
        """Read one exact original intent without invoking evidence recovery."""
        selected = _intent(intent_id)
        result = self._command("inbox-show", ["--inbox", self.directory, "--intent", selected],
                               cancel_event=cancel_event)
        if result.native.get("job", {}).get("operation", {}).get("intentId") != selected:
            raise InboxError("ORIGINAL_INBOX_INTENT_MISMATCH", result=result,
                             directory=self.directory)
        return result

    def export_operations(self, destination, *, intent_ids, max_verify_bytes=268_435_456,
                          cancel_event=None):
        """Verify selected retained output and create one private source handoff.

        A pre-existing destination is preserved. Use inspect_operations on that
        same file after an interrupted/lost return instead of recapturing state.
        """
        destination = _absolute(destination)
        if not isinstance(intent_ids, (list, tuple)) or not 1 <= len(intent_ids) <= _MAX_INTENTS:
            raise StateError("BUYER_SELECT_ORIGINAL_INTENTS")
        selected = [_intent(value) for value in intent_ids]
        if len(set(selected)) != len(selected):
            raise StateError("BUYER_SELECT_ORIGINAL_INTENTS")
        if type(max_verify_bytes) is not int or not 0 <= max_verify_bytes <= _MAX_VERIFY_BYTES:
            raise StateError("BUYER_OUTPUT_LIMIT_INVALID")
        result = self._command("inbox-export-operations", [
            "--inbox", self.directory, "--intents-json", json.dumps(selected, separators=(",", ":")),
            "--out", destination, "--max-verify-bytes", str(max_verify_bytes),
        ], destination=destination, cancel_event=cancel_event)
        if result.native.get("intentIds") != selected:
            raise InboxError("ORIGINAL_HANDOFF_SELECTION_MISMATCH", result=result,
                             directory=self.directory, destination=destination)
        return result

    def inspect_operations(self, file, *, cancel_event=None):
        """Reopen the exact saved edition, even when its original Inbox is offline."""
        file = _absolute(file)
        return self._command("inbox-inspect-operations", ["--file", file],
                             destination=file, cancel_event=cancel_event)
