"""Python access to the original Research Documents and Pipelines workspace.

Provider state, payment evidence, dossier revisions and download publication are
owned by the existing Node SDK. This module retains exact caller requests so an
interrupted application can reopen the same native action.
"""
from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
import threading

from .errors import NativeError, StateError
from .result import FileDelivery
from .runtime import Runtime
from .storage import digest, dump, lock, parse, private_directory, read

_CALL = "stellar-forge.research-python-call.v1"
_CLIENT = "stellar-forge.research-python-client.v1"
_RECORD = "stellar-forge.research-python-attempt.v1"
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")
_WORKSPACE = re.compile(r"research_[a-f0-9]{64}")
_HASH = re.compile(r"[a-f0-9]{64}")
_LIMIT = 16 * 1024 * 1024


def _json(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                          separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError):
        raise StateError("RESEARCH_JSON_REQUIRED") from None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _request_id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("RESEARCH_REQUEST_ID_REQUIRED")
    return value


class ResearchError(NativeError):
    """Original native failure, including uncertain writes and published files."""
    def __init__(self, record, *, request_id=None):
        self.record = deepcopy(record)
        native = record.get("native") or {}
        super().__init__(record.get("runtimeError") or native.get("error") or
                         "RESEARCH_NATIVE_CALL_FAILED",
                         returncode=record.get("returncode"), operation=request_id)
        self.request_id = request_id
        self.status = native.get("status")
        self.outcome_unknown = native.get("outcomeUnknown", record.get("outcomeUnknown", False))
        self.recovery = native.get("recovery")
        self.operation_id = native.get("operationId")
        self.destination_published = native.get("destinationPublished", False)
        self.file = deepcopy(native.get("file"))
        self.source_cleanup_failed = native.get("sourceCleanupFailed")


class _Cancellation(threading.Event):
    def __init__(self, external=None):
        super().__init__()
        self.external = external

    def is_set(self):
        return super().is_set() or self.external is not None and self.external.is_set()


def _completed_reply(record):
    native = record.get("native") or {}
    return (record.get("returncode") == 0 and native.get("mode") == "RESEARCH_WORKSPACE_BRIDGE"
            and native.get("ok") is True and "result" in native)


def _value(record, request_id=None):
    native = record.get("native") or {}
    if not _completed_reply(record):
        raise ResearchError(record, request_id=request_id)
    result = deepcopy(native["result"])
    if isinstance(result, dict) and (record.get("runtimeError") or record.get("interrupted")):
        result["pythonRuntime"] = {"error": record.get("runtimeError"),
                                   "interrupted": bool(record.get("interrupted")),
                                   "completedReply": True}
    if isinstance(result, dict) and native.get("sourceCleanupFailed"):
        result["sourceCleanupFailed"] = native["sourceCleanupFailed"]
    return result


def _file_delivery(value):
    if (not isinstance(value, dict) or not isinstance(value.get("file"), str) or
            not Path(value["file"]).is_absolute() or type(value.get("bytes")) is not int or
            not 0 <= value["bytes"] <= 256 * 1024 * 1024 or
            not isinstance(value.get("sha256"), str) or not _HASH.fullmatch(value["sha256"])):
        raise StateError("RESEARCH_DOWNLOAD_RECORD_INVALID")
    path = Path(value["file"])
    return FileDelivery({"returncode": 0, "native": {
        "status": "RETAINED_RESEARCH_FILE", "file": {"path": str(path), **value}}},
        path, 256 * 1024 * 1024)


class ResearchWorkspace:
    def __init__(self, *, checkout, connection_file, directory, node="node",
                 environment=None, timeout=360, request_timeout_ms=120000,
                 expected_workspace_id=None):
        if (type(request_timeout_ms) is not int or not 1000 <= request_timeout_ms <= 900000 or
                expected_workspace_id is not None and (not isinstance(expected_workspace_id, str) or not _WORKSPACE.fullmatch(expected_workspace_id))):
            raise StateError("RESEARCH_CLIENT_OPTIONS_INVALID")
        self.directory = private_directory(Path(directory))
        self.connection_file = Path(connection_file).expanduser().absolute()
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=_LIMIT)
        self.request_timeout_ms = request_timeout_ms
        self._condition = threading.Condition()
        self._active = set()
        self._closed = False
        private_directory(self.directory / "calls")
        with lock(self.directory):
            path = self.directory / "client.json"
            if path.exists():
                current = parse(read(path, 65536))
                if current.get("schema") != _CLIENT or not _WORKSPACE.fullmatch(current.get("workspaceId", "")):
                    raise StateError("RESEARCH_CLIENT_STATE_CHANGED")
                if expected_workspace_id and expected_workspace_id != current["workspaceId"]:
                    raise StateError("RESEARCH_WORKSPACE_CHANGED")
                expected_workspace_id = current["workspaceId"]
        self.workspace_id = expected_workspace_id

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        """Cancel local in-flight calls and detach; the original server stays open."""
        with self._condition:
            self._closed = True
            for event in self._active:
                event.set()
            while self._active:
                self._condition.wait(0.5)

    def _bind(self, workspace_id):
        if not isinstance(workspace_id, str) or not _WORKSPACE.fullmatch(workspace_id):
            raise StateError("RESEARCH_WORKSPACE_ID_INVALID")
        with lock(self.directory):
            path = self.directory / "client.json"
            prior = parse(read(path, 65536)) if path.exists() else None
            if (self.workspace_id and self.workspace_id != workspace_id or
                    prior and (prior.get("schema") != _CLIENT or prior.get("workspaceId") != workspace_id)):
                raise StateError("RESEARCH_WORKSPACE_CHANGED")
            if prior is None:
                dump(path, {"schema": _CLIENT, "workspaceId": workspace_id,
                            "firstObservedAt": _now()}, exclusive=True)
            self.workspace_id = workspace_id

    @contextmanager
    def _operation(self, cancel_event=None, *, owned_event=None):
        if owned_event is not None:
            with self._condition:
                if owned_event not in self._active:
                    raise StateError("RESEARCH_CALL_OWNERSHIP_LOST")
            yield owned_event
            return
        if cancel_event is not None and not isinstance(cancel_event, threading.Event):
            raise StateError("NATIVE_CANCEL_EVENT_INVALID")
        event = _Cancellation(cancel_event)
        with self._condition:
            if self._closed:
                raise StateError("RESEARCH_CLIENT_CLOSED")
            self._active.add(event)
        try:
            yield event
        finally:
            with self._condition:
                self._active.discard(event)
                self._condition.notify_all()

    def _invoke(self, action, value, request_file, *, mutating=False, event):
        request = {"schema": _CALL, "action": action, "input": deepcopy(value),
                   "connectionFile": str(self.connection_file),
                   "timeoutMs": self.request_timeout_ms}
        if self.workspace_id:
            request["expectedWorkspaceId"] = self.workspace_id
        _json(request)
        dump(request_file, request, exclusive=True)
        try:
            native = self.runtime.run(["--request", request_file], target="research",
                                      cancel_event=event)
            record = {"schema": _RECORD, "returncode": native.returncode,
                      "runtimeError": native.error, "interrupted": native.interrupted,
                      "processStarted": True,
                      "outcomeUnknown": bool(mutating and (native.interrupted or native.output is None)),
                      "native": native.output, "finishedAt": _now()}
        except NativeError as error:
            record = {"schema": _RECORD, "returncode": None, "runtimeError": error.code,
                      "processStarted": False, "outcomeUnknown": False, "native": None, "finishedAt": _now()}
        except StateError as error:
            if error.code not in {"NATIVE_CANCELLED_BEFORE_START", "NATIVE_CANCEL_EVENT_INVALID",
                    "ORIGINAL_RUNTIME_TARGET_INVALID", "ORIGINAL_APPLICATION_RUNTIME_REQUIRED"}:
                raise
            record = {"schema": _RECORD, "returncode": None, "runtimeError": error.code,
                      "processStarted": False, "outcomeUnknown": False, "native": None, "finishedAt": _now()}
        result = record.get("native") or {}
        if _completed_reply(record):
            record["outcomeUnknown"] = False
        elif "outcomeUnknown" in result:
            record["outcomeUnknown"] = bool(result["outcomeUnknown"])
        if result.get("workspaceId"):
            self._bind(result["workspaceId"])
        return record

    def _read(self, action, value=None, *, cancel_event=None, _owned_event=None):
        with self._operation(cancel_event, owned_event=_owned_event) as event:
            with tempfile.TemporaryDirectory(prefix=".research-read-", dir=self.directory) as temporary:
                record = self._invoke(action, value or {}, Path(temporary) / "request.json",
                                      event=event)
            return _value(record)

    def _directory_for_call(self, request_id, *, create=False):
        selected = self.directory / "calls" / digest(_request_id(request_id).encode())
        return private_directory(selected, create=create)

    def _write(self, action, value, *, request_id, replay_safe, resume=False, cancel_event=None):
        with self._operation(cancel_event) as event:
            return self._write_call(action, value, request_id=request_id, replay_safe=replay_safe,
                                    resume=resume, event=event)

    def _write_call(self, action, value, *, request_id, replay_safe, resume, event):
        request_id = _request_id(request_id)
        if self.workspace_id is None:
            self._read("status", _owned_event=event)
        value = parse(_json(value))
        selected = self._directory_for_call(request_id, create=True)
        with lock(selected):
            path = selected / "request.json"
            identity = {"schema": _CALL, "requestId": request_id, "action": action,
                        "input": value, "workspaceId": self.workspace_id, "replaySafe": bool(replay_safe)}
            if path.exists():
                saved = parse(read(path, 32 * 1024 * 1024))
                if _json({k: saved[k] for k in identity}) != _json(identity):
                    raise StateError("RESEARCH_REQUEST_ID_REUSED")
            else:
                saved = {**identity, "createdAt": _now()}
                dump(path, saved, exclusive=True)
            attempts = private_directory(selected / "attempts")
            existing = sorted(p for p in attempts.iterdir() if p.is_dir())
            previous = None
            if existing:
                result_path = existing[-1] / "result.json"
                previous = parse(read(result_path, _LIMIT)) if result_path.exists() else {
                    "schema": _RECORD, "returncode": None, "native": None,
                    "runtimeError": "RESEARCH_CALL_INTERRUPTED", "outcomeUnknown": True}
                native = previous.get("native") or {}
                if _completed_reply(previous):
                    return _value(previous, request_id)
                if not resume:
                    raise ResearchError(previous, request_id=request_id)
                if not replay_safe and previous.get("processStarted") is not False:
                    raise StateError("RESEARCH_RECONCILE_DOSSIER_BEFORE_NEW_WRITE")
            attempt = private_directory(attempts / str(len(existing) + 1).zfill(8))
            dump(attempt / "attempt.json", {"requestId": request_id, "startedAt": _now(),
                                           "number": len(existing) + 1}, exclusive=True)
            try:
                record = self._invoke(action, value, attempt / "call.json", mutating=True,
                                      event=event)
            except StateError as error:
                if error.code not in {"RESEARCH_CLIENT_CLOSED", "NATIVE_CANCEL_EVENT_INVALID"}:
                    raise
                record = {"schema": _RECORD, "returncode": None, "runtimeError": error.code,
                          "processStarted": False, "outcomeUnknown": False, "native": None, "finishedAt": _now()}
            dump(attempt / "result.json", record, exclusive=True)
            return _value(record, request_id)

    def call_record(self, request_id):
        selected = self._directory_for_call(request_id)
        request = parse(read(selected / "request.json", 32 * 1024 * 1024))
        attempts = sorted(p for p in (selected / "attempts").iterdir() if p.is_dir()) if (selected / "attempts").exists() else []
        last = attempts[-1] / "result.json" if attempts else None
        return {"request": request, "attempts": len(attempts),
                "result": parse(read(last, _LIMIT)) if last and last.exists() else None}

    def calls(self, *, offset=0, limit=100):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise StateError("RESEARCH_CALL_PAGE_INVALID")
        records = []
        for selected in (self.directory / "calls").iterdir():
            if selected.is_dir() and (selected / "request.json").is_file():
                request = parse(read(selected / "request.json", 32 * 1024 * 1024))
                records.append({key: request[key] for key in
                                ("requestId", "action", "createdAt", "workspaceId", "replaySafe")})
        records.sort(key=lambda item: (item["createdAt"], item["requestId"]))
        end = offset + limit
        return {"items": records[offset:end], "total": len(records),
                "nextOffset": end if end < len(records) else None}

    def resume(self, request_id, *, cancel_event=None):
        """Replay only an original native idempotent request, with unchanged IDs."""
        saved = self.call_record(request_id)["request"]
        return self._write(saved["action"], saved["input"], request_id=request_id,
                           replay_safe=saved["replaySafe"], resume=True, cancel_event=cancel_event)

    def status(self, *, cancel_event=None):
        return self._read("status", cancel_event=cancel_event)

    def dossiers(self, **options):
        return self._read("dossiers", {"options": options})

    def metadata(self, dossier_id, *, revision=None):
        return self._read("metadata", {"dossierId": dossier_id,
                          "options": {} if revision is None else {"revision": revision}})

    def section(self, dossier_id, section, **options):
        return self._read("section", {"dossierId": dossier_id, "options": {"section": section, **options}})

    def compare(self, dossier_id, **options):
        return self._read("compare", {"dossierId": dossier_id, "options": options})

    def edit(self, action, body, *, request_id, dossier_id=None, question_id=None, finding_id=None):
        """An explicit original dossier edit; uncertain writes require native readback."""
        if action not in {"create-dossier", "update-dossier", "add-question", "update-question",
                          "add-finding", "update-finding", "select-evidence", "update-selection"}:
            raise StateError("RESEARCH_EDIT_ACTION_INVALID")
        value = {"body": body}
        for key, item in (("dossierId", dossier_id), ("questionId", question_id), ("findingId", finding_id)):
            if item is not None:
                value[key] = item
        return self._write(action, value, request_id=request_id, replay_safe=False)

    def citations(self, dossier_id):
        from .research_citations import ResearchCitations
        return ResearchCitations(self, dossier_id)

    def documents(self, dossier_id):
        from .research_documents import ResearchDocuments
        return ResearchDocuments(self, dossier_id)

    def pipelines(self, dossier_id):
        from .research_documents import ResearchPipelines
        return ResearchPipelines(self, dossier_id)

    def _download(self, action, value, *, file, expected_sha256=None, _owned_event=None):
        with self._operation(owned_event=_owned_event) as event:
            return self._download_call(action, value, file=file, expected_sha256=expected_sha256,
                                       event=event)

    def _download_call(self, action, value, *, file, expected_sha256, event):
        file = Path(file).expanduser().absolute()
        if expected_sha256 is not None and (not isinstance(expected_sha256, str) or not _HASH.fullmatch(expected_sha256)):
            raise StateError("RESEARCH_DOWNLOAD_DIGEST_INVALID")
        if file.exists() and expected_sha256:
            delivery = _file_delivery({"file": str(file), "bytes": file.stat().st_size,
                                      "sha256": expected_sha256, "contentType": "application/octet-stream",
                                      "reopenedFromRetainedFile": True})
            with delivery.open():
                pass
            return delivery
        options = {**value.get("options", {}), "file": str(file)}
        if expected_sha256 is not None:
            options["expectedSha256"] = expected_sha256
        result = self._read(action, {**value, "options": options}, _owned_event=event)
        delivery = _file_delivery(result)
        with delivery.open():
            pass
        return delivery

    def export_dossier(self, dossier_id, file, *, format="json.gz", revision=None, expected_sha256=None):
        options = {"format": format}
        if revision is not None:
            options["revision"] = revision
        return self._download("export-dossier", {"dossierId": dossier_id, "options": options},
                              file=file, expected_sha256=expected_sha256)

    def export_edition(self, dossier_id, edition_id, file, *, expected_sha256=None):
        return self._download("export-edition", {"dossierId": dossier_id, "editionId": edition_id},
                              file=file, expected_sha256=expected_sha256)

    def export_comparison(self, dossier_id, file, *, before, after, expected_sha256=None):
        return self._download("export-comparison", {"dossierId": dossier_id,
                              "options": {"before": before, "after": after}},
                              file=file, expected_sha256=expected_sha256)

    def reopen_dossier(self, file, *, expected_sha256, request_id):
        return self._write("reopen-dossier", {"file": str(Path(file).expanduser().absolute()),
                           "options": {"expectedSha256": expected_sha256}},
                           request_id=request_id, replay_safe=True)

    def receive_research_file(self, dossier_id, file, *, sha256, request_id, **body):
        return self._write("receive-research-file", {"dossierId": dossier_id, "body": {
            **body, "file": str(Path(file).expanduser().absolute()), "sha256": sha256}},
            request_id=request_id, replay_safe=False)
