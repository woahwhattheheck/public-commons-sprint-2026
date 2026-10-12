"""Complete citation review on the original Research workspace and request journal.

Draft revisions are local analyst work. Only submit/recover calls the original
atomic review. Delivery selections freeze before/reviewed/current revisions;
portable readers validate the original history and source on cold receive.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

from .errors import StateError
from .research_workspace import _CALL, _LIMIT, _json, _value, _file_delivery
from .runtime import Runtime
from .storage import digest, dump, lock, parse, private_directory, read, write, sync_directory

_SCHEMA = "stellar-forge.citation-python-delivery.v1"
_DRAFT = "stellar-forge.citation-python-draft.v1"
_INPUT_LIMIT = 16 * 1024 * 1024
_STATE_LIMIT = 32 * 1024 * 1024
_FILE_LIMIT = 256 * 1024 * 1024
_HASH = re.compile(r"[a-f0-9]{64}")
_NOTICE = re.compile(r"cu_[a-f0-9]{64}")
_REVIEW_ID = re.compile(r"[A-Za-z0-9_-]{8,100}")
_LABELS = ("before", "reviewed", "current")
_FORMATS = ("html", "md", "json", "json.gz")


def _need(condition, code):
    if not condition:
        raise StateError(code)


def _exists(path):
    return path.exists() or path.is_symlink()


def _object_file(path, maximum=_STATE_LIMIT):
    value = parse(read(Path(path), maximum))
    _need(isinstance(value, dict), "CITATION_JSON_OBJECT_REQUIRED")
    return value


def _immutable(path, value):
    raw = _json(value) + b"\n"
    _need(len(raw) <= _STATE_LIMIT, "CITATION_STATE_TOO_LARGE")
    if _exists(path):
        _need(read(path, _STATE_LIMIT) == raw, "CITATION_LOCAL_RECORD_CHANGED")
    else:
        try:
            write(path, raw, exclusive=True)
        except FileExistsError:
            _need(read(path, _STATE_LIMIT) == raw, "CITATION_LOCAL_RECORD_CHANGED")
    return value


def _pin(path, maximum=_FILE_LIMIT):
    path = Path(path).expanduser().absolute()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        _need(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= maximum,
              "CITATION_REGULAR_FILE_REQUIRED")
        checksum, count = hashlib.sha256(), 0
        while block := stream.read(1024 * 1024):
            count += len(block)
            _need(count <= maximum, "CITATION_FILE_TOO_LARGE")
            checksum.update(block)
        after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        _need(count == before.st_size and all(getattr(before, key) == getattr(after, key) for key in fields),
              "CITATION_FILE_CHANGED")
    return {"file": str(path), "bytes": count, "sha256": checksum.hexdigest()}


def _workspace_identity(citations, expected=None):
    # A fresh Python client has no bound workspace until the original status
    # handshake. Compare the saved selection before any selected write/export.
    status = citations.workspace.status()
    actual = citations.workspace.workspace_id
    _need(isinstance(actual, str) and re.fullmatch(r"research_[a-f0-9]{64}", actual) and
          status.get("workspaceId") == actual and (expected is None or actual == expected),
          "CITATION_WORKSPACE_CHANGED")
    return actual


def _standalone(checkout, node, action, value, directory, *, environment=None, timeout=900):
    runtime = Runtime(checkout, node=node, environment=environment, timeout=timeout, output_limit=_LIMIT)
    with tempfile.TemporaryDirectory(prefix=".citation-call-", dir=directory) as temporary:
        request = Path(temporary) / "request.json"
        dump(request, {"schema": _CALL, "action": action, "input": value}, exclusive=True)
        result = runtime.run(["--request", request], target="research")
    return _value({"returncode": result.returncode, "runtimeError": result.error,
                   "interrupted": result.interrupted, "native": result.output})


class ResearchCitations:
    """Borrow the existing client; no listener, provider or payment is created."""
    def __init__(self, workspace, dossier_id):
        self.workspace, self.dossier_id = workspace, dossier_id

    def list(self, *, revision=None, offset=0, limit=30, status="all"):
        options = {"offset": offset, "limit": limit, "status": status}
        if revision is not None:
            options["revision"] = revision
        return self.workspace._read("citation-updates", {"dossierId": self.dossier_id, "options": options})

    def iter_notices(self, *, revision=None, status="all", limit=100):
        offset = 0
        while True:
            page = self.list(revision=revision, offset=offset, limit=limit, status=status)
            selected = page["dossier"]["revision"]
            _need(revision is None or revision == selected, "CITATION_PAGE_REVISION_CHANGED")
            revision = selected
            yield from page["items"]
            next_offset = page.get("nextOffset")
            if next_offset is None:
                return
            _need(type(next_offset) is int and next_offset > offset, "CITATION_PAGE_CURSOR_CHANGED")
            offset = next_offset

    def detail(self, notice_id, *, revision=None):
        options = {"noticeId": notice_id}
        if revision is not None:
            options["revision"] = revision
        return self.workspace._read("citation-updates", {"dossierId": self.dossier_id, "options": options})

    def validate(self, request):
        """Use the original Node review-input parser, including its full limits."""
        _need(isinstance(request, dict) and len(_json(request)) <= _INPUT_LIMIT,
              "CITATION_REVIEW_INPUT_TOO_LARGE")
        return self.workspace._read("citation-review-input", {"request": request})

    def review(self, request, *, resume=False, cancel_event=None):
        normalized = self.validate(request)["request"]
        return self.workspace._write("citation-review", {
            "dossierId": self.dossier_id, "body": normalized},
            request_id=normalized["requestId"], replay_safe=True, resume=resume,
            cancel_event=cancel_event)

    def saved_request(self, request_id):
        record = self.workspace.call_record(request_id)
        saved = record["request"]
        _need(saved["action"] == "citation-review" and
              saved["input"].get("dossierId") == self.dossier_id,
              "CITATION_CALL_SELECTION_CHANGED")
        return record

    def recover(self, request_id, *, cancel_event=None):
        self.saved_request(request_id)
        return self.workspace.resume(request_id, cancel_event=cancel_event)

    def draft(self, directory, *, notice_id, request_id, actor, revision=None):
        return CitationReviewDraft.create(self, directory, notice_id=notice_id,
                                          request_id=request_id, actor=actor, revision=revision)

    def delivery(self, request_id, directory, *, current_revision=None):
        return CitationDelivery.prepare(self, request_id, directory, current_revision=current_revision)


class CitationReviewDraft:
    """Full local revisions and an immutable pending request.

    The analyst explicitly edits JSON or uses the setters below. A stale base
    is preserved; it is never silently retargeted to the latest dossier.
    """
    def __init__(self, directory):
        self.directory = private_directory(Path(directory), create=False)
        self.selection = _object_file(self.directory / "selection.json")
        _need(self.selection.get("schema") == _DRAFT, "CITATION_DRAFT_CHANGED")
        self.revisions = private_directory(self.directory / "revisions", create=False)

    @classmethod
    def create(cls, citations, directory, *, notice_id, request_id, actor, revision=None):
        _need(isinstance(request_id, str) and _REVIEW_ID.fullmatch(request_id),
              "CITATION_REVIEW_REQUEST_REQUIRED")
        _need(isinstance(notice_id, str) and _NOTICE.fullmatch(notice_id), "CITATION_NOTICE_INVALID")
        root = private_directory(Path(directory))
        private_directory(root / "revisions")
        private_directory(root / "inputs")
        with lock(root):
            path = root / "selection.json"
            if _exists(path):
                saved = _object_file(path)
                _need(saved.get("dossierId") == citations.dossier_id and
                      saved.get("noticeId") == notice_id and saved.get("requestId") == request_id and
                      saved.get("actor") == actor and
                      (revision is None or saved.get("revision") == revision),
                      "CITATION_DRAFT_SELECTION_CHANGED")
                _workspace_identity(citations, saved.get("workspaceId"))
                selected = saved
            else:
                workspace_id = _workspace_identity(citations)
                page = citations.detail(notice_id, revision=revision)
                selected = {"schema": _DRAFT, "dossierId": citations.dossier_id,
                    "noticeId": notice_id, "requestId": request_id, "actor": actor,
                    "revision": page["dossier"]["revision"],
                    "workspaceId": workspace_id, "original": page}
                _immutable(path, selected)
            detail = selected["original"]["detail"]
            initial = {"requestId": request_id, "noticeId": notice_id,
                "expectedRevision": selected["revision"], "expectedFingerprint": detail["fingerprint"],
                "actor": actor, "decision": "follow-up", "reason": "",
                "evidenceChanges": [{key: row[key] for key in
                    ("occurrenceId", "selected", "classification", "note")} for row in detail["evidence"]],
                "findingChanges": [{key: row[key] for key in
                    ("id", "title", "text", "occurrenceIds")} for row in detail["findings"]],
                "findingDispositions": [{"findingId": row["id"], "disposition": "unchanged", "reason": ""}
                                        for row in detail["findings"]]}
            first = root / "revisions" / "00000001.json"
            if not _exists(first):
                _immutable(first, {"schema": _DRAFT, "editRevision": 1,
                    "previousSha256": None, "request": initial, "sourceInput": None})
        return cls(root)

    def current(self):
        paths = sorted(path for path in self.revisions.iterdir()
                       if re.fullmatch(r"[0-9]{8}\.json", path.name))
        _need(paths and [p.name for p in paths] ==
              [str(index).zfill(8) + ".json" for index in range(1, len(paths) + 1)],
              "CITATION_DRAFT_HISTORY_INCOMPLETE")
        previous = None
        last = None
        for index, path in enumerate(paths, 1):
            raw = read(path, _STATE_LIMIT)
            value = parse(raw)
            _need(value.get("schema") == _DRAFT and value.get("editRevision") == index and
                  value.get("previousSha256") == previous, "CITATION_DRAFT_HISTORY_CHANGED")
            self._binding(value["request"])
            previous, last = digest(raw), value
        return deepcopy(last)

    def _binding(self, request):
        selected = self.selection
        _need(isinstance(request, dict) and request.get("requestId") == selected["requestId"] and
              request.get("noticeId") == selected["noticeId"] and
              request.get("expectedRevision") == selected["revision"] and
              request.get("expectedFingerprint") == selected["original"]["detail"]["fingerprint"],
              "CITATION_DRAFT_BASE_CHANGED")

    def replace(self, request, *, expected_edit_revision, source_bytes=None):
        self._binding(request)
        _need(len(_json(request)) <= _INPUT_LIMIT, "CITATION_REVIEW_INPUT_TOO_LARGE")
        with lock(self.directory):
            _need(not _exists(self.directory / "pending.json"), "CITATION_PENDING_REQUEST_FROZEN")
            current = self.current()
            _need(current["editRevision"] == expected_edit_revision, "CITATION_DRAFT_REVISION_CONFLICT")
            if source_bytes is not None:
                _need(isinstance(source_bytes, bytes) and len(source_bytes) <= _INPUT_LIMIT and
                      parse(source_bytes) == request, "CITATION_INPUT_BYTES_CHANGED")
                sha = digest(source_bytes)
                path = self.directory / "inputs" / (sha + ".json")
                if _exists(path):
                    _need(read(path, _INPUT_LIMIT) == source_bytes, "CITATION_INPUT_BYTES_CHANGED")
                else:
                    write(path, source_bytes, exclusive=True)
                source = {"file": "inputs/" + path.name, "bytes": len(source_bytes), "sha256": sha}
            else:
                source = None
            number = expected_edit_revision + 1
            _need(number < 100000000, "CITATION_DRAFT_REVISION_LIMIT")
            previous = read(self.revisions / (str(expected_edit_revision).zfill(8) + ".json"), _STATE_LIMIT)
            value = {"schema": _DRAFT, "editRevision": number, "previousSha256": digest(previous),
                     "request": deepcopy(request), "sourceInput": source}
            return _immutable(self.revisions / (str(number).zfill(8) + ".json"), value)

    def import_file(self, file, *, expected_edit_revision):
        raw = read(Path(file), _INPUT_LIMIT)
        return self.replace(parse(raw), expected_edit_revision=expected_edit_revision, source_bytes=raw)

    def export_request(self, file):
        path = Path(file).expanduser().absolute()
        write(path, _json(self.current()["request"]) + b"\n", exclusive=True)
        return _pin(path, _INPUT_LIMIT)

    def edit(self, *, expected_edit_revision, decision=None, reason=None, actor=None,
             evidence=None, finding=None, disposition=None):
        current = self.current()
        _need(current["editRevision"] == expected_edit_revision, "CITATION_DRAFT_REVISION_CONFLICT")
        request = current["request"]
        for key, value in (("decision", decision), ("reason", reason), ("actor", actor)):
            if value is not None:
                request[key] = value
        for value, name, key in ((evidence, "evidenceChanges", "occurrenceId"),
                                 (finding, "findingChanges", "id"),
                                 (disposition, "findingDispositions", "findingId")):
            if value is None:
                continue
            _need(isinstance(value, dict) and key in value, "CITATION_EDIT_RECORD_REQUIRED")
            positions = [i for i, item in enumerate(request[name]) if item[key] == value[key]]
            _need(len(positions) == 1, "CITATION_EDIT_OUTSIDE_DRAFT")
            request[name][positions[0]] = deepcopy(value)
        return self.replace(request, expected_edit_revision=expected_edit_revision)

    def freeze(self, citations, *, expected_edit_revision):
        _need(citations.dossier_id == self.selection["dossierId"], "CITATION_DRAFT_SELECTION_CHANGED")
        _workspace_identity(citations, self.selection["workspaceId"])
        with lock(self.directory):
            current = self.current()
            _need(current["editRevision"] == expected_edit_revision, "CITATION_DRAFT_REVISION_CONFLICT")
            checked = citations.validate(current["request"])
            value = {"schema": _DRAFT, "editRevision": expected_edit_revision,
                "request": checked["request"], "requestSha256": checked["sha256"],
                "draftSha256": digest(read(self.revisions / (str(expected_edit_revision).zfill(8) + ".json"), _STATE_LIMIT)),
                "workspaceId": self.selection["workspaceId"], "dossierId": citations.dossier_id}
            return _immutable(self.directory / "pending.json", value)

    def submit(self, citations, *, expected_edit_revision, recover=False):
        pending = self.freeze(citations, expected_edit_revision=expected_edit_revision)
        _need(citations.workspace.workspace_id == pending["workspaceId"], "CITATION_WORKSPACE_CHANGED")
        # The existing Python call journal owns the first attempt and recovery.
        # Pending bytes survive errors, close, restart and later dossier edits.
        return citations.review(pending["request"], resume=recover)


class CitationDelivery:
    def __init__(self, directory):
        self.directory = private_directory(Path(directory), create=False)
        self.selection_file = self.directory / "selection.json"
        self.selection = _object_file(self.selection_file)
        _need(self.selection.get("schema") == _SCHEMA, "CITATION_DELIVERY_CHANGED")
        self.selection_pin = _pin(self.selection_file, _STATE_LIMIT)
        self.files = private_directory(self.directory / "files", create=False)

    @classmethod
    def prepare(cls, citations, request_id, directory, *, current_revision=None):
        workspace_id = _workspace_identity(citations)
        root = private_directory(Path(directory))
        private_directory(root / "files")
        with lock(root):
            selected_file = root / "selection.json"
            if _exists(selected_file):
                old = _object_file(selected_file)
                _need(old.get("workspaceId") == workspace_id and
                      old.get("dossierId") == citations.dossier_id and
                      old.get("request", {}).get("requestId") == request_id and
                      (current_revision is None or old["snapshots"]["current"]["revision"] == current_revision),
                      "CITATION_DELIVERY_SELECTION_CHANGED")
                return cls(root)
            call = citations.saved_request(request_id)
            _need(call["request"].get("workspaceId") == workspace_id, "CITATION_WORKSPACE_CHANGED")
            _need(call["result"] is not None, "CITATION_SAVED_REVIEW_REPLY_REQUIRED")
            reply = _value(call["result"], request_id)
            request = call["request"]["input"]["body"]
            review = reply["review"]
            _need(review["request"] == request and review["requestId"] == request_id,
                  "CITATION_SAVED_REVIEW_CHANGED")
            if current_revision is None:
                current_revision = citations.workspace.metadata(citations.dossier_id)["revision"]
            _need(type(current_revision) is int and current_revision >= review["revision"],
                  "CITATION_DELIVERY_REVISION_INVALID")
            snapshots = {}
            for label, revision in zip(_LABELS, (review["originalRevision"], review["revision"], current_revision)):
                snapshots[label] = {"revision": revision,
                    "metadata": citations.workspace.metadata(citations.dossier_id, revision=revision),
                    "detail": citations.detail(request["noticeId"], revision=revision)}
            saved = next((item for item in snapshots["current"]["detail"]["detail"]["reviews"]
                          if item["id"] == review["id"]), None)
            _need(saved == review, "CITATION_SAVED_REVIEW_CHANGED")
            history, offset = [], 0
            while True:
                page = citations.workspace.section(citations.dossier_id, "revisions",
                    revision=current_revision, offset=offset, limit=100)
                _need(page["revision"] == current_revision, "CITATION_HISTORY_REVISION_CHANGED")
                history.extend(page["items"])
                next_offset = page.get("nextOffset")
                if next_offset is None:
                    break
                _need(type(next_offset) is int and next_offset > offset, "CITATION_HISTORY_CURSOR_CHANGED")
                offset = next_offset
            value = {"schema": _SCHEMA, "dossierId": citations.dossier_id,
                "noticeId": request["noticeId"], "workspaceId": workspace_id,
                "request": request, "review": review, "snapshots": snapshots, "history": history}
            _immutable(selected_file, value)
        return cls(root)

    def _options(self):
        actual = _pin(self.selection_file, _STATE_LIMIT)
        _need(actual == self.selection_pin, "CITATION_DELIVERY_SELECTION_CHANGED")
        return {"selectionFile": str(self.selection_file), "selectionSha256": actual["sha256"]}

    def export(self, citations):
        _need(citations.dossier_id == self.selection["dossierId"], "CITATION_DELIVERY_WORKSPACE_CHANGED")
        _workspace_identity(citations, self.selection["workspaceId"])
        with lock(self.directory):
            records = []
            for label in _LABELS:
                revision = self.selection["snapshots"][label]["revision"]
                for format in _FORMATS:
                    name = label + "-r" + str(revision) + "." + format
                    value = citations.workspace._read("citation-export", {
                        **self._options(), "label": label, "format": format, "file": str(self.files / name)})
                    with _file_delivery(value).open():
                        pass
                    _need(value.get("revision") == revision, "CITATION_EXPORT_REVISION_CHANGED")
                    records.append({"name": name, "label": label, "format": format, "revision": revision,
                        **{key: value[key] for key in ("bytes", "sha256", "contentType")}})
            manifest = {"schema": _SCHEMA, "selectionSha256": self.selection_pin["sha256"],
                        "dossierId": self.selection["dossierId"], "reviewId": self.selection["review"]["id"],
                        "files": records}
            _immutable(self.directory / "delivery.json", manifest)
        return manifest

    def verify(self):
        manifest = _object_file(self.directory / "delivery.json")
        _need(manifest.get("schema") == _SCHEMA and
              manifest.get("selectionSha256") == self._options()["selectionSha256"],
              "CITATION_DELIVERY_CHANGED")
        expected = {(label, fmt) for label in _LABELS for fmt in _FORMATS}
        _need(len(manifest["files"]) == len(expected) and
              {(f["label"], f["format"]) for f in manifest["files"]} == expected,
              "CITATION_DELIVERY_INCOMPLETE")
        for item in manifest["files"]:
            _need(item["name"] == item["label"] + "-r" + str(item["revision"]) + "." + item["format"] and
                  item["revision"] == self.selection["snapshots"][item["label"]]["revision"],
                  "CITATION_DELIVERY_MEMBER_CHANGED")
            actual = _pin(self.files / item["name"])
            _need(actual["bytes"] == item["bytes"] and actual["sha256"] == item["sha256"],
                  "CITATION_DELIVERY_BYTES_CHANGED")
        return manifest

    def receive(self, directory, *, checkout, node="node", environment=None, timeout=900):
        manifest = self.verify()
        root = private_directory(Path(directory))
        results = {}
        with lock(root):
            for format, name in (("json", "json-reader"), ("json.gz", "stream-reader")):
                item = next(row for row in manifest["files"] if row["label"] == "current" and row["format"] == format)
                result = _standalone(checkout, node, "citation-receive", {
                    **self._options(), "label": "current", "format": format,
                    "file": str(self.files / item["name"]), "expectedSha256": item["sha256"],
                    "expectedBytes": item["bytes"], "directory": str(root / name)},
                    root, environment=environment, timeout=timeout)
                for report in result["reports"]:
                    original = next(row for row in manifest["files"] if
                        row["label"] == report["label"] and row["format"] == report["format"])
                    _need(all(report[key] == original[key] for key in ("revision", "bytes", "sha256")),
                          "CITATION_RECEIVED_REPORT_CHANGED")
                _need(result.get("reviewPresent") is True and result["reviewId"] == self.selection["review"]["id"],
                      "CITATION_RECEIVED_REVIEW_MISSING")
                results[name] = result
            _immutable(self.directory / "receiving.json", {"schema": _SCHEMA,
                "selectionSha256": self.selection_pin["sha256"], "results": results})
        return results

    def verify_receiving(self):
        self.verify()
        path = self.directory / "receiving.json"
        _need(_exists(path), "CITATION_COMPLETED_RECEIVING_REQUIRED")
        value = _object_file(path)
        _need(value.get("schema") == _SCHEMA and
              value.get("selectionSha256") == self.selection_pin["sha256"] and
              set(value.get("results", {})) == {"json-reader", "stream-reader"},
              "CITATION_RECEIVING_CHANGED")
        for name, format in (("json-reader", "json"), ("stream-reader", "json.gz")):
            result = value["results"][name]
            _need(result.get("identity", {}).get("selectionSha256") == self.selection_pin["sha256"] and
                  result["identity"].get("label") == "current" and result["identity"].get("format") == format and
                  result.get("reviewId") == self.selection["review"]["id"] and
                  result.get("reviewPresent") is True, "CITATION_RECEIVING_CHANGED")
        return value

    @classmethod
    def from_archive(cls, file, directory, *, expected_sha256):
        """Receive the complete analyst ZIP without replacing existing customer files."""
        actual = _pin(file, 512 * 1024 * 1024)
        _need(isinstance(expected_sha256, str) and _HASH.fullmatch(expected_sha256) and
              actual["sha256"] == expected_sha256, "CITATION_HANDOVER_DIGEST_CHANGED")
        root = private_directory(Path(directory))
        with lock(root):
            _immutable(root / "receiving-input.json", {"schema": _SCHEMA,
                       "bytes": actual["bytes"], "sha256": actual["sha256"]})
            with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as raw:
                before = os.fstat(raw.fileno())
                _need(stat.S_ISREG(before.st_mode) and before.st_size == actual["bytes"],
                      "CITATION_HANDOVER_CHANGED")
                checksum = hashlib.sha256()
                count = 0
                while block := raw.read(1024 * 1024):
                    count += len(block)
                    _need(count <= actual["bytes"], "CITATION_HANDOVER_CHANGED")
                    checksum.update(block)
                _need(count == actual["bytes"] and checksum.hexdigest() == actual["sha256"],
                      "CITATION_HANDOVER_CHANGED")
                raw.seek(0)
                with zipfile.ZipFile(raw) as archive:
                    info = archive.getinfo("handover-manifest.json")
                    _need(info.file_size <= _STATE_LIMIT, "CITATION_HANDOVER_MANIFEST_TOO_LARGE")
                    members = parse(archive.read(info))
                    _need(members.get("schema") == _SCHEMA and isinstance(members.get("members"), dict),
                          "CITATION_HANDOVER_MANIFEST_INVALID")
                    expected = members["members"]
                    _need(len(expected) <= 10000 and
                          len(archive.infolist()) == len(expected) + 1 and
                          set(archive.namelist()) == set(expected) | {"handover-manifest.json"} and
                          {"selection.json", "delivery.json", "receiving.json"} <= set(expected),
                          "CITATION_HANDOVER_MEMBERS_CHANGED")
                    total = info.file_size
                    for name, pin in expected.items():
                        _need(isinstance(name, str) and not name.startswith("/") and chr(92) not in name and
                              all(part not in {"", ".", ".."} for part in name.split("/")) and
                              (name in {"selection.json", "delivery.json", "receiving.json"} or
                               name.startswith(("files/", "analysis/", "inputs/"))), "CITATION_HANDOVER_PATH_INVALID")
                        _need(isinstance(pin, dict) and type(pin.get("bytes")) is int and
                              0 <= pin["bytes"] <= _FILE_LIMIT and isinstance(pin.get("sha256"), str) and
                              _HASH.fullmatch(pin["sha256"]), "CITATION_HANDOVER_MANIFEST_INVALID")
                        total += pin["bytes"]
                        _need(total <= 512 * 1024 * 1024, "CITATION_HANDOVER_SIZE_LIMIT")
                        member = archive.getinfo(name)
                        _need(member.file_size == pin["bytes"] and not member.is_dir() and
                              stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG),
                              "CITATION_HANDOVER_MEMBER_CHANGED")
                        parent = root
                        for component in name.split("/")[:-1]:
                            parent = private_directory(parent / component)
                        target = parent / name.split("/")[-1]
                        if _exists(target):
                            saved = _pin(target)
                            _need(all(saved[key] == pin[key] for key in ("bytes", "sha256")),
                                  "CITATION_RECEIVED_FILE_CHANGED")
                            continue
                        fd, temporary = tempfile.mkstemp(prefix=".citation-receive-", dir=parent)
                        try:
                            with os.fdopen(fd, "wb") as output, archive.open(member) as source:
                                checksum, count = hashlib.sha256(), 0
                                while block := source.read(1024 * 1024):
                                    count += len(block)
                                    _need(count <= pin["bytes"], "CITATION_HANDOVER_MEMBER_CHANGED")
                                    checksum.update(block)
                                    output.write(block)
                                _need(count == pin["bytes"] and checksum.hexdigest() == pin["sha256"],
                                      "CITATION_HANDOVER_MEMBER_CHANGED")
                                output.flush()
                                os.fsync(output.fileno())
                            os.link(temporary, target)
                            sync_directory(parent)
                        finally:
                            Path(temporary).unlink(missing_ok=True)
                    _immutable(root / "handover-manifest.json", members)
                after = os.fstat(raw.fileno())
                _need(all(getattr(before, key) == getattr(after, key) for key in
                          ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")),
                      "CITATION_HANDOVER_CHANGED")
        delivery = cls(root)
        delivery.verify_receiving()
        return delivery

    def archive(self, file, *, extras=None):
        """Publish one complete portable analyst handover with exact member bytes."""
        manifest = self.verify()
        self.verify_receiving()
        members = {"selection.json": self.selection_file, "delivery.json": self.directory / "delivery.json",
                   "receiving.json": self.directory / "receiving.json"}
        members.update({"files/" + item["name"]: self.files / item["name"] for item in manifest["files"]})
        for name, path in (extras or {}).items():
            _need(isinstance(name, str) and name.startswith(("analysis/", "inputs/")) and chr(92) not in name and
                  all(part not in {"", ".", ".."} for part in name.split("/")) and name not in members,
                  "CITATION_HANDOVER_EXTRA_PATH_INVALID")
            members[name] = Path(path)
        pins = {name: _pin(path, _STATE_LIMIT if name in {"selection.json", "delivery.json", "receiving.json"} else _FILE_LIMIT)
                for name, path in members.items()}
        _need(sum(value["bytes"] for value in pins.values()) <= 512 * 1024 * 1024,
              "CITATION_HANDOVER_SIZE_LIMIT")
        destination = Path(file).expanduser().absolute()
        private_directory(destination.parent)
        with lock(self.directory):
            manifest_file = self.directory / "handover-manifest.json"
            _immutable(manifest_file, {"schema": _SCHEMA, "members": {
                name: {key: item[key] for key in ("bytes", "sha256")} for name, item in pins.items()}})
            members["handover-manifest.json"] = manifest_file
            pins["handover-manifest.json"] = _pin(manifest_file, _STATE_LIMIT)
            _need(sum(value["bytes"] for value in pins.values()) <= 512 * 1024 * 1024,
                  "CITATION_HANDOVER_SIZE_LIMIT")
            if not _exists(destination):
                fd, temporary = tempfile.mkstemp(prefix=".citation-handover-", dir=destination.parent)
                os.close(fd)
                try:
                    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        for name, path in sorted(members.items()):
                            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = 0o100600 << 16
                            with _file_delivery(pins[name]).open() as source, archive.open(info, "w", force_zip64=True) as target:
                                while block := source.read(1024 * 1024):
                                    target.write(block)
                    _need(os.stat(temporary).st_size <= 512 * 1024 * 1024, "CITATION_HANDOVER_SIZE_LIMIT")
                    with open(temporary, "rb") as saved:
                        os.fsync(saved.fileno())
                    os.link(temporary, destination)
                    sync_directory(destination.parent)
                finally:
                    Path(temporary).unlink(missing_ok=True)
            with os.fdopen(os.open(destination, os.O_RDONLY | os.O_NOFOLLOW), "rb") as raw:
                with zipfile.ZipFile(raw) as archive:
                    _need(len(archive.infolist()) == len(pins) and set(archive.namelist()) == set(pins),
                          "CITATION_HANDOVER_MEMBERS_CHANGED")
                    for name, expected in pins.items():
                        info = archive.getinfo(name)
                        _need(info.file_size == expected["bytes"], "CITATION_HANDOVER_MEMBER_CHANGED")
                        with archive.open(info) as source:
                            checksum, count = hashlib.sha256(), 0
                            while block := source.read(1024 * 1024):
                                count += len(block)
                                _need(count <= expected["bytes"], "CITATION_HANDOVER_MEMBER_CHANGED")
                                checksum.update(block)
                        _need(count == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                              "CITATION_HANDOVER_MEMBER_CHANGED")
            artifact = _pin(destination, 512 * 1024 * 1024)
            _immutable(self.directory / "handover.json", {
                "schema": _SCHEMA, "filename": destination.name,
                "bytes": artifact["bytes"], "sha256": artifact["sha256"],
                "members": {name: {key: pin[key] for key in ("bytes", "sha256")} for name, pin in pins.items()}})
        return artifact
