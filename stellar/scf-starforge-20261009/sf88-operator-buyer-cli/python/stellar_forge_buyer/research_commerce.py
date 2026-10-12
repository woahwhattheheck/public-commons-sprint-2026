"""Paid Research delivery through the original merchant and Buyer workspace.

The native SF101 checkout owns the order and payment terms. The original Buyer
Runbook owns approval, execution, cancellation and retrieval. This Python client
retains full request/reply bytes and receives the same editable dossier, work
snapshot, reports and optional source workspace.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from pathlib import Path
import re
import tempfile
from typing import Any, Iterator, TYPE_CHECKING

from .errors import StateError
from .research_workspace import _file_delivery, _json, _request_id
from .research_customer_updates import ResearchCustomerDelivery
from .storage import digest, parse, read

if TYPE_CHECKING:
    from .research_workspace import ResearchWorkspace
    from .research_commerce_types import (
        CommercePublicationRequest, CommercePublicationEnrollment,
        CommercePurchasePreparation, CommercePurchaseAction,
        CommercePurchaseCancellation, CommercePurchaseReconciliation,
        CommercePurchaseReceiving, CommerceOperationResult,
    )

COLLECTIONS = ("publications", "purchases")
FILE_PARTS = ("publication", "handoff", "archive", "received")
BUYER_ACTIONS = ("execute", "retrieve", "recover", "finalize", "cancel")
NATIVE_WRITES = (
    "commerce-publication-prepare", "commerce-publication-enroll",
    "commerce-purchase-receive", "commerce-purchase-prepare",
    "commerce-execute", "commerce-retrieve", "commerce-recover",
    "commerce-finalize", "commerce-cancel", "commerce-reconcile",
    "commerce-receive-dossier",
)
_WRITES = {*NATIVE_WRITES, "commerce-export", "commerce-replay", "commerce-archive-receive"}
_LOCAL = {"commerce-operation", "commerce-archive-inspect", "commerce-archive-receive"}
_RESPONSE = "sf88-research-commerce-python-response/v1"
_RESPONSE_FILE = "sf88-research-commerce-python-file/v1"
_OPERATOR = "sf88-research-commerce-operator-result/v1"
_EXPORT = "sf88-research-commerce-export-result/v1"
_ARCHIVE = "sf88-research-paid-archive-received/v1"
_CONTROL_LIMIT = 2 * 1024 * 1024
_PUBLICATION_LIMIT = 1024 * 1024
_ARCHIVE_LIMIT = 32 * 1024 * 1024
_RESPONSE_LIMIT = 66 * 1024 * 1024 + 65536
_HASH = re.compile(r"[a-f0-9]{64}")


def _need(value, code):
    if not value:
        raise StateError(code)


def _snapshot(value):
    return parse(_json(value))


def _hash(value):
    _need(isinstance(value, str) and _HASH.fullmatch(value),
          "RESEARCH_COMMERCE_SHA256_REQUIRED")
    return value


def _absolute(value):
    return str(Path(value).expanduser().absolute())


def _call_id(action, value, selected):
    if selected is not None:
        return _request_id(selected)
    native_id = value.get("requestId") or value.get("id")
    _need(isinstance(native_id, str), "RESEARCH_COMMERCE_CALL_ID_REQUIRED")
    return _request_id(action + ":" + native_id)


def _retained_file(value):
    _need(isinstance(value, dict) and isinstance(value.get("path"), str),
          "RESEARCH_COMMERCE_FILE_REQUIRED")
    return _file_delivery({**value, "file": value["path"]})


class ResearchCommerceArchive:
    """A complete locally received original Research handover.

    Construction reopens the compressed archive and every native member, using
    the original FileDelivery reader and ResearchCustomerDelivery contracts.
    No running Research server or original download location is needed.
    """
    def __init__(self, received):
        self._record = _snapshot(received)
        _need(isinstance(self._record, dict) and self._record.get("schema") == _ARCHIVE,
              "RESEARCH_COMMERCE_RECEIVED_ARCHIVE_REQUIRED")
        directory = self._record.get("directory")
        _need(isinstance(directory, str) and Path(directory).is_absolute(),
              "RESEARCH_COMMERCE_RECEIVED_ARCHIVE_REQUIRED")
        self.directory = Path(directory)
        selected = self._record.get("archive")
        _need(isinstance(selected, dict) and
              selected.get("name") == "research-customer.handover.gz" and
              selected.get("contentType") == "application/gzip" and
              type(selected.get("bytes")) is int and 0 < selected["bytes"] <= _ARCHIVE_LIMIT and
              selected.get("path") == str(self.directory / selected["name"]),
              "RESEARCH_COMMERCE_RECEIVED_ARCHIVE_CHANGED")
        _hash(self._record.get("manifestSha256"))
        self._archive = _retained_file(selected)
        self._handover = ResearchCustomerDelivery(self._record.get("handover"))
        _need(self._handover.manifest_sha256 == self._record["manifestSha256"] and
              self._handover.directory == self.directory / "handover",
              "RESEARCH_COMMERCE_RECEIVED_HANDOVER_CHANGED")
        with self._archive.open():
            pass

    @property
    def record(self):
        return deepcopy(self._record)

    @property
    def archive(self):
        return self._archive

    @property
    def handover(self):
        return self._handover

    def verify(self):
        with self._archive.open():
            pass
        return {"archive": deepcopy(self._record["archive"]),
                "handover": self._handover.verify(), "directory": str(self.directory)}


class ResearchCommerce:
    """Original paid-delivery operations on one retained ResearchWorkspace.

    Each write has a Python call ID and its original native request ID. The
    former identifies the local attempt; the latter remains unchanged through
    native receiving, retry and explicit replay.
    """
    def __init__(self, workspace: ResearchWorkspace):
        self.workspace = workspace

    def _decode(self, descriptor, action, selected, expected_workspace):
        _need(isinstance(descriptor, dict) and descriptor.get("schema") == _RESPONSE_FILE,
              "RESEARCH_COMMERCE_PYTHON_RESPONSE_INVALID")
        _hash(descriptor.get("callSha256"))
        value = _snapshot(selected)
        directory = Path(value.pop("responseDirectory"))
        file = descriptor.get("file")
        _need(isinstance(file, dict) and file.get("file") == str(directory / "response.json"),
              "RESEARCH_COMMERCE_PYTHON_RESPONSE_FILE_CHANGED")
        body = _file_delivery(file).json(limit=_RESPONSE_LIMIT)
        call = {"action": action, "input": value, "expectedWorkspaceId": expected_workspace}
        _need(isinstance(body, dict) and body.get("schema") == _RESPONSE and
              body.get("call") == call and body.get("callSha256") == descriptor["callSha256"] and
              body.get("workspaceId") == descriptor.get("workspaceId") and "result" in body,
              "RESEARCH_COMMERCE_PYTHON_RESPONSE_CHANGED")
        identity = body.get("workspaceId")
        if action in _LOCAL:
            _need(identity is None, "RESEARCH_LOCAL_WORKSPACE_CHANGED")
        else:
            _need(identity is not None and
                  (expected_workspace is None or identity == expected_workspace),
                  "RESEARCH_WORKSPACE_CHANGED")
            self.workspace._bind(identity)
        result = deepcopy(body["result"])
        if isinstance(result, dict):
            for key in ("pythonRuntime", "sourceCleanupFailed"):
                if descriptor.get(key) is not None:
                    result[key] = deepcopy(descriptor[key])
        return result

    def _read(self, action, value=None, *, cancel_event=None, _owned_event=None):
        value = _snapshot(value or {})
        local = action in _LOCAL
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            with tempfile.TemporaryDirectory(prefix=".commerce-read-", dir=self.workspace.directory) as temporary:
                selected = {**value, "responseDirectory": str(Path(temporary).resolve())}
                expected = None if local else self.workspace.workspace_id
                descriptor = self.workspace._read(action, selected, _owned_event=event, local=local)
                return self._decode(descriptor, action, selected, expected)

    def _write(self, action, value, *, call_id, resume=False, cancel_event=None,
               _owned_event=None):
        _need(action in _WRITES, "RESEARCH_COMMERCE_ACTION_INVALID")
        value = _snapshot(value)
        _need(len(_json(value)) <= _CONTROL_LIMIT + 65536,
              "RESEARCH_COMMERCE_PYTHON_INPUT_TOO_LARGE")
        local = action in _LOCAL
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            if self.workspace.workspace_id is None and not local:
                self.workspace._read("status", _owned_event=event)
            directory = self.workspace._directory_for_call(_request_id(call_id), create=True)
            selected = {**value,
                        "directory": value.get("directory", str(directory / "commerce-operation")),
                        "responseDirectory": str(directory / "commerce-response")}
            expected = None if local else self.workspace.workspace_id
            descriptor = self.workspace._write_call(action, selected, request_id=call_id,
                replay_safe=True, resume=resume, event=event, local=local)
            result = self._decode(descriptor, action, selected, expected)
            return self._verify_completed(action, result)

    @staticmethod
    def _verify_completed(action, result):
        if action in NATIVE_WRITES or action == "commerce-replay":
            _need(isinstance(result, dict) and result.get("schema") == _OPERATOR and
                  isinstance(result.get("result"), dict),
                  "RESEARCH_COMMERCE_OPERATOR_RESULT_CHANGED")
        elif action == "commerce-export":
            _need(isinstance(result, dict) and result.get("schema") == _EXPORT,
                  "RESEARCH_COMMERCE_EXPORT_RESULT_CHANGED")
            with _retained_file(result.get("file")).open():
                pass
        elif action == "commerce-archive-receive":
            ResearchCommerceArchive(result)
        return result

    def configuration(self, *, cancel_event=None):
        return self._read("commerce-configuration", cancel_event=cancel_event)

    def list(self, kind, *, offset=0, limit=30, snapshot=None, cancel_event=None):
        _need(kind in COLLECTIONS and type(offset) is int and offset >= 0 and
              type(limit) is int and 1 <= limit <= 100 and (offset == 0 or snapshot is not None),
              "RESEARCH_COMMERCE_PAGE_INVALID")
        options = {"offset": offset, "limit": limit}
        if snapshot is not None:
            options["snapshot"] = _hash(snapshot)
        return self._read("commerce-list", {"kind": kind, "options": options}, cancel_event=cancel_event)

    def iter_records(self, kind, *, limit=100, cancel_event=None) -> Iterator[dict[str, Any]]:
        """Read all original pages pinned to the first native collection snapshot."""
        offset, total, snapshot = 0, None, None
        while True:
            page = self.list(kind, offset=offset, limit=limit, snapshot=snapshot, cancel_event=cancel_event)
            _need((snapshot is None or page["snapshot"] == snapshot) and
                  (total is None or page["total"] == total),
                  "RESEARCH_COMMERCE_PAGE_CHANGED")
            snapshot, total = page["snapshot"], page["total"]
            yield from deepcopy(page["items"])
            following = page["nextOffset"]
            if following is None:
                return
            _need(type(following) is int and following > offset and following <= total,
                  "RESEARCH_COMMERCE_PAGE_CHANGED")
            offset = following

    def publication(self, publication_id, *, cancel_event=None):
        return self._read("commerce-publication", {"id": publication_id}, cancel_event=cancel_event)

    def purchase(self, purchase_id, *, refresh=False, cancel_event=None):
        _need(type(refresh) is bool, "RESEARCH_COMMERCE_REFRESH_INVALID")
        return self._read("commerce-purchase", {"id": purchase_id, "options": {"refresh": refresh}},
                          cancel_event=cancel_event)

    def file(self, kind, identifier, part, *, cancel_event=None):
        _need(kind in COLLECTIONS and part in FILE_PARTS, "RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED")
        return self._read("commerce-file", {"kind": kind, "id": identifier, "part": part},
                          cancel_event=cancel_event)

    def submit(self, command, value, *, call_id=None, resume=False, cancel_event=None):
        """Send one complete original native input; monetary strings stay exact."""
        action = command if command.startswith("commerce-") else "commerce-" + command
        _need(action in NATIVE_WRITES, "RESEARCH_COMMERCE_COMMAND_INVALID")
        selected = _snapshot(value)
        _need(isinstance(selected, dict), "RESEARCH_COMMERCE_FIELDS_INVALID")
        return self._write(action, {"input": selected},
            call_id=_call_id(action, selected, call_id), resume=resume, cancel_event=cancel_event)

    def prepare_publication(self, value: CommercePublicationRequest, **options) -> CommerceOperationResult:
        return self.submit("publication-prepare", value, **options)

    def enroll_publication(self, value: CommercePublicationEnrollment, **options) -> CommerceOperationResult:
        return self.submit("publication-enroll", value, **options)

    def receive_purchase(self, value, **options) -> CommerceOperationResult:
        return self.submit("purchase-receive", value, **options)

    def receive_publication_file(self, path, *, buyer, request_id, call_id=None,
                                 expected_sha256=None, resume=False, cancel_event=None):
        """Retain complete selected publication bytes in the original request.

        An unchanged saved call can reopen when its donor file has moved. If the
        donor is still present, its complete bytes must match the retained input.
        """
        action = "commerce-purchase-receive"
        selected_id = _call_id(action, {"requestId": request_id}, call_id)
        source = Path(path).expanduser().absolute()
        if expected_sha256 is not None:
            _hash(expected_sha256)
        with self.workspace._operation(cancel_event) as event:
            call_directory = self.workspace._directory_for_call(selected_id, create=True)
            if (call_directory / "request.json").exists():
                saved = self.workspace.call_record(selected_id)["request"]
                value = saved.get("input", {}).get("input")
                _need(saved.get("action") == action and isinstance(value, dict) and
                      value.get("requestId") == request_id and value.get("buyer") == buyer and
                      value.get("filename") == source.name,
                      "RESEARCH_COMMERCE_PUBLICATION_INPUT_CHANGED")
                try:
                    body = base64.b64decode(value["base64"], validate=True)
                except (KeyError, ValueError):
                    raise StateError("RESEARCH_COMMERCE_PUBLICATION_ENCODING_INVALID") from None
                if source.exists() or source.is_symlink():
                    _need(read(source, _PUBLICATION_LIMIT) == body,
                          "RESEARCH_COMMERCE_PUBLICATION_INPUT_CHANGED")
            else:
                body = read(source, _PUBLICATION_LIMIT)
                value = {"requestId": request_id, "buyer": buyer, "filename": source.name,
                         "base64": base64.b64encode(body).decode("ascii")}
            _need(0 < len(body) <= _PUBLICATION_LIMIT and
                  (expected_sha256 is None or digest(body) == expected_sha256),
                  "RESEARCH_COMMERCE_PUBLICATION_INPUT_CHANGED")
            return self._write(action, {"input": value}, call_id=selected_id, resume=resume,
                               _owned_event=event)

    def prepare_purchase(self, value: CommercePurchasePreparation, **options) -> CommerceOperationResult:
        return self.submit("purchase-prepare", value, **options)

    def action(self, kind, value: CommercePurchaseAction, **options) -> CommerceOperationResult:
        _need(kind in BUYER_ACTIONS, "RESEARCH_COMMERCE_BUYER_ACTION_INVALID")
        return self.submit(kind, value, **options)

    def execute(self, value: CommercePurchaseAction, **options) -> CommerceOperationResult:
        return self.action("execute", value, **options)

    def retrieve(self, value: CommercePurchaseAction, **options) -> CommerceOperationResult:
        return self.action("retrieve", value, **options)

    def recover_purchase(self, value: CommercePurchaseAction, **options) -> CommerceOperationResult:
        """Ask the original Buyer to recover its selected purchase operation."""
        return self.action("recover", value, **options)

    def finalize(self, value: CommercePurchaseAction, **options) -> CommerceOperationResult:
        return self.action("finalize", value, **options)

    def cancel(self, value: CommercePurchaseCancellation, **options) -> CommerceOperationResult:
        """Reach the same execution from a separate retained call and native request."""
        return self.action("cancel", value, **options)

    def reconcile(self, value: CommercePurchaseReconciliation, **options):
        return self.submit("reconcile", value, **options)

    def receive_dossier(self, value: CommercePurchaseReceiving, **options) -> CommerceOperationResult:
        return self.submit("receive-dossier", value, **options)

    def export(self, kind, identifier, part, *, call_id, expected_sha256=None,
               resume=False, cancel_event=None):
        """Retain the full original file locally, then reopen it on subsequent calls."""
        _need(kind in COLLECTIONS and part in FILE_PARTS, "RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED")
        value = {"kind": kind, "id": identifier, "part": part}
        if expected_sha256 is not None:
            value["expectedSha256"] = _hash(expected_sha256)
        return self._write("commerce-export", value, call_id=call_id, resume=resume,
                           cancel_event=cancel_event)

    @staticmethod
    def exported_file(result):
        _need(isinstance(result, dict) and result.get("schema") == _EXPORT,
              "RESEARCH_COMMERCE_EXPORT_RESULT_CHANGED")
        value = _retained_file(result.get("file"))
        with value.open():
            pass
        return value

    def inspect_archive(self, path, *, expected_sha256, expected_bytes, cancel_event=None):
        _need(type(expected_bytes) is int and 0 < expected_bytes <= _ARCHIVE_LIMIT,
              "RESEARCH_COMMERCE_ARCHIVE_SIZE_INVALID")
        return self._read("commerce-archive-inspect", {"path": _absolute(path),
            "expectedSha256": _hash(expected_sha256), "expectedBytes": expected_bytes},
            cancel_event=cancel_event)

    def receive_archive(self, *, expected_sha256, expected_bytes, manifest_sha256,
                        call_id, path=None, directory=None, resume=False, cancel_event=None):
        """Receive complete native archive members with a durable local write attempt."""
        _need(type(expected_bytes) is int and 0 < expected_bytes <= _ARCHIVE_LIMIT,
              "RESEARCH_COMMERCE_ARCHIVE_SIZE_INVALID")
        value = {"expectedSha256": _hash(expected_sha256), "expectedBytes": expected_bytes,
                 "manifestSha256": _hash(manifest_sha256)}
        with self.workspace._operation(cancel_event) as event:
            call_directory = self.workspace._directory_for_call(_request_id(call_id), create=True)
            if (call_directory / "request.json").exists():
                saved = self.workspace.call_record(call_id)["request"]
                prior = saved.get("input", {})
                _need(saved.get("action") == "commerce-archive-receive" and
                      all(prior.get(key) == item for key, item in value.items()) and
                      (directory is None or _absolute(directory) == prior.get("directory")) and
                      (path is None or _absolute(path) == prior.get("path")),
                      "RESEARCH_COMMERCE_ARCHIVE_SELECTION_CHANGED")
                value = {key: item for key, item in prior.items() if key != "responseDirectory"}
            else:
                if directory is not None:
                    value["directory"] = _absolute(directory)
                if path is not None:
                    value["path"] = _absolute(path)
            return self._write("commerce-archive-receive", value, call_id=call_id,
                               resume=resume, _owned_event=event)

    def saved(self, call_id):
        """Return the first completed local result without dispatching native work."""
        saved = self.workspace.call_record(_request_id(call_id))
        request, record = saved["request"], saved.get("result")
        _need(request.get("action") in _WRITES and request.get("replaySafe") is True,
              "RESEARCH_COMMERCE_SAVED_CALL_REQUIRED")
        if not record:
            return {"request": deepcopy(request), "attempts": saved["attempts"], "completed": False}
        from .research_workspace import _completed_reply, _value
        if not _completed_reply(record):
            return {"request": deepcopy(request), "attempts": saved["attempts"],
                    "completed": False, "attempt": deepcopy(record)}
        result = self._decode(_value(record, call_id), request["action"], request["input"],
                              request["workspaceId"])
        return {"request": deepcopy(request), "attempts": saved["attempts"], "completed": True,
                "result": self._verify_completed(request["action"], result)}

    def recover(self, call_id, *, cancel_event=None):
        """Recover this same local call; preserve its original native request and reply."""
        saved = self.workspace.call_record(_request_id(call_id))["request"]
        _need(saved.get("action") in _WRITES and saved.get("replaySafe") is True,
              "RESEARCH_COMMERCE_SAVED_CALL_REQUIRED")
        with self.workspace._operation(cancel_event) as event:
            descriptor = self.workspace._write_call(saved["action"], saved["input"],
                request_id=call_id, replay_safe=True, resume=True, event=event,
                local=saved.get("local", False))
            result = self._decode(descriptor, saved["action"], saved["input"], saved["workspaceId"])
            return self._verify_completed(saved["action"], result)

    def replay(self, call_id, *, replay_id, cancel_event=None):
        """Actually submit the original native request in a distinct durable attempt.

        Recovering replay_id subsequently returns its first saved reply. A replay
        may be the original request's first completed mutation, so it always uses
        ResearchWorkspace's mutating attempt and uncertain-outcome semantics.
        """
        _request_id(call_id);_request_id(replay_id)
        _need(call_id != replay_id, "RESEARCH_COMMERCE_REPLAY_CALL_ID_REQUIRED")
        with self.workspace._operation(cancel_event) as event:
            target = self.workspace._directory_for_call(replay_id, create=True)
            if (target / "request.json").exists():
                saved_replay = self.workspace.call_record(replay_id)["request"]
                expected_source = str(self.workspace._directory_for_call(call_id, create=True) /
                                      "commerce-operation")
                _need(saved_replay.get("action") == "commerce-replay" and
                      saved_replay.get("input", {}).get("sourceDirectory") == expected_source,
                      "RESEARCH_COMMERCE_REPLAY_CALL_CHANGED")
                value = {key: item for key, item in saved_replay["input"].items()
                         if key not in {"directory", "responseDirectory"}}
            else:
                original = self.workspace.call_record(call_id)["request"]
                _need(original.get("action") in {*NATIVE_WRITES, "commerce-replay"} and
                      original.get("replaySafe") is True,
                      "RESEARCH_COMMERCE_REPLAY_SOURCE_REQUIRED")
                native = (deepcopy(original["input"]["original"])
                          if original["action"] == "commerce-replay" else
                          {"action": original["action"], "input": deepcopy(original["input"]["input"]),
                           "workspaceId": original["workspaceId"]})
                value = {"sourceDirectory": original["input"]["directory"], "original": native}
            return self._write("commerce-replay", value, call_id=replay_id,
                               resume=True, _owned_event=event)

    def operation(self, call_id, *, cancel_event=None):
        """Inspect the existing original native operator directory for a Python call."""
        original = self.workspace.call_record(_request_id(call_id))["request"]
        _need(original.get("action") in {*NATIVE_WRITES, "commerce-replay", "commerce-export"},
              "RESEARCH_COMMERCE_OPERATOR_CALL_REQUIRED")
        return self._read("commerce-operation", {"directory": original["input"]["directory"]},
                          cancel_event=cancel_event)
