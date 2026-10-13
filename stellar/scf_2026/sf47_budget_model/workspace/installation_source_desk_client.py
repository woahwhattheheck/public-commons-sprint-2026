"""Original Source Desk client and durable commissioning archive operations.

Callers supply the already-open SourceDesk. This module opens no workspace or
connection and uses the original model digest, owner transaction and journal.
"""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
from pathlib import Path
import re
from typing import Any
import uuid

from model import digest
from operations_installation_sources import SCHEMA, MAX_FILE, SourceDesk

OPERATION_SCHEMA = "stellar-forge.installation-source-desk-operation.v1"
ARCHIVE_SCHEMA = "stellar-forge.installation-commissioning-archive.v1"
COMMISSIONING_SCHEMA = "stellar-forge.installation-commissioning-receiving.v1"
CASE = re.compile(r"operation-[a-f0-9]{32}")
DRAFT = re.compile(r"source-desk-[a-f0-9]{32}")
REQUEST = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
SHA = re.compile(r"[a-f0-9]{64}")


def need(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _object(value: Any, label: str) -> dict:
    need(isinstance(value, dict), "Keep the complete " + label + " object.")
    return value


def _identity(case_id: str, draft_id: str) -> None:
    need(isinstance(case_id, str) and CASE.fullmatch(case_id) is not None,
         "Select the original Operations case.")
    need(isinstance(draft_id, str) and DRAFT.fullmatch(draft_id) is not None,
         "Select the original Source Desk draft.")


def _revision(value: Any) -> int:
    need(isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10000,
         "Keep the original whole reviewed draft revision.")
    return value


def _context(actor: str, request_id: str | None, note: str) -> dict:
    need(isinstance(actor, str) and bool(actor.strip()) and len(actor) <= 300,
         "Record the original operator name.")
    request_id = request_id or "source-desk-" + uuid.uuid4().hex
    need(isinstance(request_id, str) and REQUEST.fullmatch(request_id) is not None,
         "Use one stable original request ID.")
    need(isinstance(note, str) and len(note) <= 12000, "Keep the complete operator note.")
    return {"requestId": request_id, "actor": actor, "note": note}


def native_request_sha256(case_id: str, draft_id: str, body: dict) -> str:
    _identity(case_id, draft_id)
    _object(body, "original command")
    return digest({"schema": SCHEMA, "caseId": case_id, "draftId": draft_id, "body": body})


def _review(value: dict, expected_schema: str) -> dict:
    value = deepcopy(_object(value, "saved native preview"))
    seal = value.pop("previewSha256", None)
    need(value.get("schema") == expected_schema and isinstance(seal, str) and
         SHA.fullmatch(seal) is not None and digest(value) == seal,
         "The complete saved native preview differs from its original seal.")
    value["previewSha256"] = seal
    _revision(value.get("draftRevision"))
    _object(value.get("selection"), "normalized native selection")
    return value


def prepare_command(case_id: str, draft_id: str, body: dict, *,
                    workspace_directory: str | None = None, review: dict | None = None) -> dict:
    """Retain a complete unchanged native command before any mutation."""
    _identity(case_id, draft_id)
    body = deepcopy(_object(body, "original command"))
    need(not set(body) - {"requestId", "expectedRevision", "actor", "note", "action", "data"} and
         {"requestId", "expectedRevision", "actor", "action", "data"} <= set(body),
         "Keep only the complete declared original command fields.")
    need(isinstance(body["requestId"], str) and REQUEST.fullmatch(body["requestId"]) is not None,
         "Keep the original explicit request ID in the saved command.")
    _context(body["actor"], body["requestId"], body.get("note", ""))
    _revision(body["expectedRevision"])
    need(isinstance(body["action"], str) and bool(body["action"]), "Keep the original action.")
    _object(body["data"], "original action data")
    operation = {"schema": OPERATION_SCHEMA, "caseId": case_id, "draftId": draft_id,
                 "request": body, "requestSha256": native_request_sha256(case_id, draft_id, body)}
    if workspace_directory is not None:
        directory = Path(workspace_directory).expanduser().absolute()
        need(directory.resolve() == directory, "Select the existing canonical workspace directory.")
        operation["workspaceDirectory"] = str(directory)
    if review is not None:
        operation["review"] = deepcopy(review)
    operation["operationSha256"] = digest(operation)
    return validate_operation(operation)


def validate_operation(value: dict, *, case_id: str | None = None,
                       draft_id: str | None = None, workspace_directory: str | None = None) -> dict:
    operation = deepcopy(_object(value, "prepared original operation"))
    need(not set(operation) - {"schema", "caseId", "draftId", "request", "requestSha256",
                               "workspaceDirectory", "review", "operationSha256"},
         "The prepared operation contains undeclared fields.")
    seal = operation.pop("operationSha256", None)
    need(isinstance(seal, str) and SHA.fullmatch(seal) is not None and digest(operation) == seal and
         operation.get("schema") == OPERATION_SCHEMA,
         "The complete saved operation differs from its retained identity.")
    operation["operationSha256"] = seal
    cid, did, body = operation.get("caseId"), operation.get("draftId"), operation.get("request")
    _identity(cid, did)
    need(case_id is None or cid == case_id, "The saved operation belongs to a different original case.")
    need(draft_id is None or did == draft_id, "The saved operation belongs to a different original draft.")
    need(operation.get("requestSha256") == native_request_sha256(cid, did, body),
         "The saved operation differs from the exact original command payload.")
    need(not set(body) - {"requestId", "expectedRevision", "actor", "note", "action", "data"} and
         {"requestId", "expectedRevision", "actor", "action", "data"} <= set(body),
         "Keep the original command envelope unchanged.")
    need(isinstance(body["requestId"], str) and REQUEST.fullmatch(body["requestId"]) is not None,
         "Keep the original explicit request ID in the saved command.")
    _context(body["actor"], body["requestId"], body.get("note", ""))
    _revision(body["expectedRevision"])
    _object(body["data"], "original command data")
    if workspace_directory is not None and "workspaceDirectory" in operation:
        directory = str(Path(workspace_directory).expanduser().absolute())
        need(directory == operation["workspaceDirectory"],
             "This operation was prepared for a different original workspace directory.")
    if "review" in operation:
        action = body["action"]
        schema = ARCHIVE_SCHEMA if action == "commissioning.archive.receive" else COMMISSIONING_SCHEMA
        need(action in ("commissioning.archive.receive", "commissioning.attach"),
             "A native review must belong to its declared original action.")
        review = _review(operation["review"], schema)
        need(review.get("caseId") == cid and review.get("draftId") == did and
             review["draftRevision"] == body["expectedRevision"] and
             body["data"] == {**review["selection"], "expectedPreviewSha256": review["previewSha256"]},
             "The saved command must use the full original normalized review without edits.")
        if action == "commissioning.archive.receive":
            need(review.get("ready") is True, "Resolve the original archive review before receiving.")
    return operation


def prepare_upload(case_id: str, draft_id: str, raw: bytes, *, filename: str,
                   source_url: str, observed_at: str, expected_revision: int, actor: str,
                   request_id: str | None = None, note: str = "",
                   media_type: str = "application/x-tar",
                   workspace_directory: str | None = None) -> dict:
    """Keep complete original bytes, URL and observation in the native file.add."""
    need(isinstance(raw, bytes) and 0 < len(raw) <= MAX_FILE,
         "Select one complete nonempty original file of at most 8 MiB.")
    data = {"filename": filename, "mediaType": media_type, "sourceUrl": source_url,
            "observedAt": observed_at, "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "contentBase64": base64.b64encode(raw).decode("ascii")}
    context = _context(actor, request_id, note)
    body = {"requestId": context["requestId"], "expectedRevision": _revision(expected_revision),
            "actor": actor, "note": note, "action": "file.add", "data": data}
    return prepare_command(case_id, draft_id, body, workspace_directory=workspace_directory)


def prepare_review(value: dict, action: str, *, actor: str, request_id: str | None = None,
                   note: str = "", workspace_directory: str | None = None) -> dict:
    need(action in ("commissioning.archive.receive", "commissioning.attach"),
         "Select the original archive receive or phase attachment action.")
    schema = ARCHIVE_SCHEMA if action == "commissioning.archive.receive" else COMMISSIONING_SCHEMA
    review = _review(value, schema)
    if action == "commissioning.archive.receive":
        need(review.get("ready") is True,
             "Review the original filename replacements and capacity before receiving.")
    context = _context(actor, request_id, note)
    body = {"requestId": context["requestId"], "expectedRevision": review["draftRevision"],
            "actor": actor, "note": note, "action": action,
            "data": {**deepcopy(review["selection"]), "expectedPreviewSha256": review["previewSha256"]}}
    return prepare_command(review["caseId"], review["draftId"], body,
                           workspace_directory=workspace_directory, review=review)


def receiving_selection(receipt: dict, *, case_id: str | None = None,
                        draft_id: str | None = None) -> dict:
    """Return the native post-receive selection for the next original read."""
    receipt = _object(receipt, "original archive receiving receipt")
    draft, result = _object(receipt.get("draft"), "saved draft"), _object(receipt.get("result"), "archive result")
    need(receipt.get("schema") == SCHEMA and result.get("schema") == ARCHIVE_SCHEMA and
         result.get("state") == "RECEIVED_COMMISSIONING_ARCHIVE" and
         result.get("caseId") == draft.get("caseId") and result.get("draftId") == draft.get("id"),
         "Select the complete original archive receive receipt.")
    need(case_id is None or draft.get("caseId") == case_id,
         "The receive receipt belongs to a different original case.")
    need(draft_id is None or draft.get("id") == draft_id,
         "The receive receipt belongs to a different original draft.")
    selection = deepcopy(_object(result.get("receivingSelection"), "original receiving selection"))
    need(set(selection) == {"captureFileId", "fileIds"}, "Keep the native receiving selection unchanged.")
    return {"expectedRevision": _revision(draft["revision"]), **selection}


class InstallationSourceDeskClient:
    """A typed native adapter over one existing original SourceDesk owner."""

    def __init__(self, desk: SourceDesk, case_id: str, draft_id: str,
                 *, workspace_directory: str | None = None) -> None:
        _identity(case_id, draft_id)
        self.desk, self.case_id, self.draft_id = desk, case_id, draft_id
        self.workspace_directory = workspace_directory

    def read(self, revision: int | None = None) -> dict:
        return self.desk.get(self.case_id, self.draft_id, revision)

    def edition_compare(self, selection: dict) -> dict:
        return self.desk.edition_compare(self.case_id, self.draft_id, deepcopy(selection))

    def edition_preview(self, selection: dict) -> dict:
        return self.desk.edition_preview(self.case_id, self.draft_id, deepcopy(selection))

    def prepare_edition(self, plan: dict, *, actor: str, request_id: str,
                        note: str = "") -> dict:
        from operations_installation_source_editions import PLAN, unseal
        value = unseal(plan, PLAN)
        need(value.get("caseId") == self.case_id and
             value.get("target", {}).get("draftId") == self.draft_id,
             "Select this client's original complete target edition.")
        context = _context(actor, request_id, note)
        body = {**context, "expectedRevision": _revision(value["target"]["revision"]),
                "action": "edition.apply", "data": {"plan": deepcopy(plan)}}
        return self.prepare_command(body)

    def mapping_compare(self, selection: dict) -> dict:
        return self.desk.mapping_compare(self.case_id, self.draft_id, deepcopy(selection))

    def mapping_preview(self, selection: dict) -> dict:
        return self.desk.mapping_preview(self.case_id, self.draft_id, deepcopy(selection))

    def prepare_mapping(self, plan: dict, *, actor: str, request_id: str,
                        note: str = "") -> dict:
        from operations_installation_mapping_reconciliation import verify_plan
        value = verify_plan(self.desk, self.case_id, self.draft_id, plan)
        context = _context(actor, request_id, note)
        body = {**context, "expectedRevision": _revision(value["target"]["revision"]),
                "action": "mapping.apply", "data": {"plan": deepcopy(plan)}}
        return self.prepare_command(body)

    def archive_inspect(self, archive_file_id: str, expected_revision: int,
                        replace_file_ids: list[str] | None = None) -> dict:
        return self.desk.commissioning_archive_inspect(self.case_id, self.draft_id, {
            "expectedRevision": expected_revision, "archiveFileId": archive_file_id,
            "replaceFileIds": deepcopy(replace_file_ids or [])})

    def commissioning_inspect(self, selection: dict) -> dict:
        return self.desk.commissioning_inspect(self.case_id, self.draft_id, deepcopy(selection))

    def commissioning_preview(self, selection: dict) -> dict:
        return self.desk.commissioning_preview(self.case_id, self.draft_id, deepcopy(selection))

    def prepare_command(self, body: dict) -> dict:
        return prepare_command(self.case_id, self.draft_id, body,
                               workspace_directory=self.workspace_directory)

    def prepare_review(self, preview: dict, action: str, **context: Any) -> dict:
        value = prepare_review(preview, action, workspace_directory=self.workspace_directory, **context)
        return validate_operation(value, case_id=self.case_id, draft_id=self.draft_id)

    def lookup(self, request_id: str) -> dict:
        return self.desk.request(self.case_id, self.draft_id, request_id)

    def reconcile(self, operation: dict) -> dict:
        operation = validate_operation(operation, case_id=self.case_id, draft_id=self.draft_id,
                                       workspace_directory=self.workspace_directory)
        result = self.lookup(operation["request"]["requestId"])
        if result.get("state") == "RECORDED":
            receipt = _object(result.get("result"), "original recorded receipt")
            need(receipt.get("requestId") == operation["request"]["requestId"] and
                 receipt.get("requestSha256") == operation["requestSha256"] and
                 receipt.get("draft", {}).get("caseId") == self.case_id and
                 receipt.get("draft", {}).get("id") == self.draft_id,
                 "The original journal has this request ID for a different complete payload.")
        else:
            need(result.get("state") == "NOT_RECORDED", "Keep the original request lookup result.")
        return result

    def execute(self, operation: dict) -> dict:
        """Observe the saved journal first; perform at most one native mutation."""
        operation = validate_operation(operation, case_id=self.case_id, draft_id=self.draft_id,
                                       workspace_directory=self.workspace_directory)
        prior = self.reconcile(operation)
        if prior["state"] == "RECORDED":
            return prior["result"]
        result = self.desk.command(self.case_id, self.draft_id, deepcopy(operation["request"]))
        need(result.get("requestSha256") == operation["requestSha256"],
             "The original mutation returned a different request identity.")
        return result

    def file(self, file_id: str, expected_sha256: str, revision: int | None = None) -> tuple[dict, bytes]:
        metadata, raw = self.desk.file(self.case_id, self.draft_id, file_id, revision)
        need(metadata.get("sha256") == expected_sha256 and len(raw) == metadata.get("bytes") and
             hashlib.sha256(raw).hexdigest() == expected_sha256,
             "The complete native download differs from its expected original bytes.")
        return metadata, raw


class FlowableSourceDeskClient:
    """The original case plus complete Node-owned source sidecars.

    No workspace, HTTP listener or connection is created here. Explicit request
    UUIDs are retained by the same service and original Python case binding.
    """
    def __init__(self, desk: SourceDesk, case_id: str):
        need(isinstance(case_id, str) and CASE.fullmatch(case_id) is not None,
             "Select the original Operations case.")
        self.desk, self.case_id = desk, case_id

    def perform(self, action: str, body: dict) -> dict:
        from operations_flowable_sources import perform
        return perform(self.desk.ops, self.case_id, action, deepcopy(body))

    def request(self, request_id: str) -> dict:
        from operations_flowable_sources import lookup
        return lookup(self.desk.ops, self.case_id, request_id)

    def list(self, offset: int = 0, limit: int = 100) -> dict:
        from operations_flowable_sources import _engine
        return _engine(self.desk.ops, self.case_id, "list", {"offset": offset, "limit": limit})

    def import_file(self, path: str, *, request_id: str, kind: str,
                    expected_sha256: str, name: str | None = None) -> dict:
        import os
        import stat
        from operations_flowable_sources import import_stream, MAX_ARCHIVE
        path = Path(path).expanduser().absolute()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_ARCHIVE,
                 "Select one complete bounded original file.")
            with os.fdopen(fd, "rb", closefd=False) as source:
                result = import_stream(self.desk.ops, self.case_id, source, request_id=request_id,
                    kind=kind, name=name or path.name, size=before.st_size, sha256=expected_sha256)
            after = os.fstat(fd)
            need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                 (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                 "The complete original input changed during upload.")
            return result
        finally:
            os.close(fd)

    def file(self, file_id: str) -> dict:
        from operations_flowable_sources import file_descriptor
        value = file_descriptor(self.desk.ops, self.case_id, file_id=file_id)
        return deepcopy(value["file"])

    def export_file(self, destination: str, expected_sha256: str, *,
                    file_id: str | None = None, inspection_id: str | None = None,
                    path: str | None = None) -> dict:
        from operations_flowable_sources import export_file
        return export_file(self.desk.ops, self.case_id, destination, expected_sha256,
                           file_id=file_id, inspection_id=inspection_id, path=path)


    def archive(self, request_id: str) -> dict:
        from operations_flowable_sources import preparation_archive
        return deepcopy(preparation_archive(self.desk.ops, self.case_id, request_id)["file"])

    def export_archive(self, request_id: str, destination: str, expected_sha256: str) -> dict:
        from operations_flowable_sources import preparation_archive, export_descriptor
        descriptor = preparation_archive(self.desk.ops, self.case_id, request_id)
        return export_descriptor(self.desk.ops, self.case_id, descriptor, destination, expected_sha256)
