"""Run the complete original customer programme from two existing Python clients.

The original Node receiving engine owns every phase and saved request. Selecting
its existing programme directory adopts the same baseline, update, reports,
received dossier and correction; this wrapper creates no parallel programme.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import threading

from .errors import StateError
from .research_customer_updates import ResearchCustomerUpdates, _snapshot, _need, _hash
from .storage import digest, parse, read


class ResearchCustomerCancelled(BaseException):
    """Whole-program stop; original child finally blocks still finish cleanup."""
    code = "RESEARCH_CUSTOMER_PROGRAMME_CANCELLED"


class _ProgrammeCancellation(threading.Event):
    def __init__(self, external):
        super().__init__()
        self.external = external
        self.owners = []

    def is_set(self):
        # The original owner Events refer back to this combined cancellation.
        # Read their own close flags through Event itself to avoid recursion.
        return (super().is_set() or self.external is not None and self.external.is_set()
                or any(threading.Event.is_set(owner) for owner in self.owners))


def run_research_customer_delivery(*, sender, receiver, directory, case_file,
                                   request_id, expected_case_sha256=None,
                                   resume=False, cancel_event=None):
    """Complete or resume the SAME original native delivery programme.

    sender/receiver are existing ResearchWorkspace instances. Closing either
    waits for this accepted operation and stops its original native process.
    The caller retains ownership of both Python clients and both host servers.
    """
    if cancel_event is not None and not isinstance(cancel_event, threading.Event):
        raise StateError("NATIVE_CANCEL_EVENT_INVALID")
    selected_file = Path(case_file).expanduser().absolute()
    raw = read(selected_file, 16 * 1024 * 1024)
    if expected_case_sha256 is not None:
        _need(digest(raw) == _hash(expected_case_sha256), "CUSTOMER_UPDATE_ORIGINAL_CASE_CHANGED")
    case = parse(raw)
    _need(isinstance(case, dict) and case.get("schema") == "sf88-research-customer-delivery-case/v1",
          "CUSTOMER_UPDATE_ORIGINAL_CASE_REQUIRED")
    client = ResearchCustomerUpdates(sender, case["dossierId"])
    value = {"directory": str(Path(directory).expanduser().absolute()),
             "dossierId": case["dossierId"], "caseDefinition": _snapshot(case)}
    cancellation = _ProgrammeCancellation(cancel_event)
    with sender._operation(cancellation) as sender_event:
        with receiver._operation(cancellation) as receiver_event:
            cancellation.owners = [sender_event, receiver_event]
            if receiver.workspace_id is None:
                receiver._read("status", _owned_event=receiver_event)
            value["receiver"] = {"connectionFile": str(receiver.connection_file),
                                 "workspaceId": receiver.workspace_id}
            result = client._write("customer-delivery-programme", value, request_id=request_id,
                                   resume=resume, _owned_event=sender_event)
            _need(result.get("dossierId", result.get("source", {}).get("dossierId")) == case["dossierId"]
                  and result.get("receiver", {}).get("workspaceId") == receiver.workspace_id,
                  "CUSTOMER_UPDATE_CASE_WORKSPACE_CHANGED")
            return deepcopy(result)
