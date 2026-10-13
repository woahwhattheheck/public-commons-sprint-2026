"""Customer quotations through the original Research, commercial and pricing engines.

Native case revisions, quote reviews, customer responses and paid-publication
requests keep their original identities. Complete inputs and replies live beside
the existing ResearchWorkspace call journal.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
import tempfile
from typing import Any, Iterator, TYPE_CHECKING

from .errors import StateError
from .research_workspace import _file_delivery, _json, _request_id
from .storage import digest, dump, lock, parse, private_directory, read, write

if TYPE_CHECKING:
    from .research_workspace import ResearchWorkspace
    from .research_quote_types import (
        QuoteCaseSelection, QuoteBriefSelection, QuoteResponseSelection,
        QuotePublicationSelection, QuoteReportSelection, QuoteApplySelection,
        QuoteOperatorResult, QuoteExportResult, QuoteConfiguration, QuoteOperation,
    )

KINDS = ("CASE", "BRIEF", "RESPONSE", "PUBLICATION", "REALIZED")
COMMANDS = ("create-case", "native-case", "pricing", "prepare", "apply",
            "prepare-response", "prepare-publication", "enroll-publication", "prepare-report")
CASE_ACTIONS = (
    "preview", "save-draft", "publish", "receive", "receive-pricing", "compare",
    "preview-implementation", "adopt-implementation", "receiving-status",
    "receiving-capture", "receiving-inspect", "receiving-attach", "receiving-case",
    "receiving-restore", "tariff-status", "tariff-catalog", "tariff-selection",
    "tariff-capture", "tariff-inspect", "tariff-attach", "tariff-case", "tariff-restore",
)
PRICING_ACTIONS = (
    "state", "preview", "save", "version", "compare", "planning-state",
    "planning-preview", "planning-save", "planning-read", "economics-state",
    "economics-preview", "economics-save", "economics-edition", "economics-proposal",
    "economics-apply", "repricing-source", "repricing-preview", "repricing-save", "repricing-stage",
)
_WRITES = {
    "quotes-submit", "quotes-export-operation", "quotes-export-case",
    "quotes-export-tariff", "quotes-download", "quotes-replay", "quotes-copy-export",
}
_LOCAL = {"quotes-run-inspect", "quotes-copy-export"}
_RESPONSE = "sf88-research-quotes-python-response/v1"
_RESPONSE_FILE = "sf88-research-quotes-python-file/v1"
_OPERATOR = "sf88-research-quote-operator-result/v1"
_EXPORT = "sf88-research-quote-export-result/v1"
_COPY = "sf88-research-quotes-python-export-copy/v1"
_DOWNLOAD = "sf88-research-quotes-python-download/v1"
_INPUT_LIMIT = 96 * 1024 * 1024 + 65536
_FILE_LIMIT = 256 * 1024 * 1024
_CONTROL_LIMIT = 1024 * 1024
_HASH = re.compile(r"[a-f0-9]{64}")
_WORKSPACE = re.compile(r"research_[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,179}")
_UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")


def _need(value, code):
    if not value:
        raise StateError(code)


def _snapshot(value):
    return parse(_json(value))


def _hash(value):
    _need(isinstance(value, str) and _HASH.fullmatch(value), "RESEARCH_QUOTE_SHA256_REQUIRED")
    return value


def _id(value):
    _need(isinstance(value, str) and _UUID.fullmatch(value), "RESEARCH_QUOTE_REQUEST_ID_REQUIRED")
    return value


def _absolute(value):
    return str(Path(value).expanduser().absolute())


def _object(body):
    value = parse(body)
    _need(isinstance(value, dict), "RESEARCH_QUOTE_FIELDS_INVALID")
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
        elif type(item) is int:
            _need(abs(item) <= 9007199254740991, "RESEARCH_QUOTE_JSON_INTEGER_REQUIRES_STRING")
    return value


def _input_bytes(value):
    body = _json(value)
    _need(0 < len(body) <= _INPUT_LIMIT, "RESEARCH_QUOTE_REQUEST_TOO_LARGE")
    _object(body)
    return body


def _retain(path, body):
    if path.exists() or path.is_symlink():
        _need(read(path, max(_INPUT_LIMIT, _FILE_LIMIT)) == body, "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
    else:
        write(path, body, exclusive=True)


def _retained_input(directory, *, value=None, source=None, expected_sha256=None):
    """Keep the first complete raw input before the original call can dispatch."""
    root = private_directory(directory)
    if expected_sha256 is not None:
        _hash(expected_sha256)
    _need(not (value is not None and source is not None), "RESEARCH_QUOTE_SELECT_ONE_INPUT")
    with lock(root):
        path, metadata_path = root / "input.json", root / "source.json"
        prior = parse(read(metadata_path, 65536)) if metadata_path.exists() else None
        if path.exists() or path.is_symlink():
            body = read(path, _INPUT_LIMIT)
            if value is not None:
                _need(_input_bytes(value) == body, "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
            if source is not None:
                selected = Path(source).expanduser().absolute()
                if selected.exists() or selected.is_symlink():
                    _need(read(selected, _INPUT_LIMIT) == body, "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
        else:
            _need(prior is None, "RESEARCH_QUOTE_RETAINED_INPUT_MISSING")
            if source is not None:
                body = read(Path(source).expanduser().absolute(), _INPUT_LIMIT)
            else:
                _need(value is not None, "RESEARCH_QUOTE_INPUT_REQUIRED")
                body = _input_bytes(value)
        _need(0 < len(body) <= _INPUT_LIMIT, "RESEARCH_QUOTE_REQUEST_TOO_LARGE")
        native = _object(body)
        sha256 = digest(body)
        _need(expected_sha256 is None or sha256 == expected_sha256, "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
        metadata = {"schema": "sf88-research-quotes-python-input/v1",
                    "name": "input.json", "bytes": len(body), "sha256": sha256}
        _need(prior is None or prior == metadata, "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
        _retain(path, body)
        if prior is None:
            dump(metadata_path, metadata, exclusive=True)
        return {"inputFile": str(path), "inputBytes": len(body), "inputSha256": sha256}, native


def _verify_selected_input(selected):
    """Reopen the exact retained source even when its completed call needs no process."""
    value = selected.get("original") if "original" in selected else selected
    _need(isinstance(value, dict), "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
    if "inputFile" not in value:
        return
    path = value.get("inputFile")
    _need(isinstance(path, str) and Path(path).is_absolute() and
          type(value.get("inputBytes")) is int and 0 < value["inputBytes"] <= _INPUT_LIMIT,
          "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
    body = read(Path(path), _INPUT_LIMIT)
    _need(len(body) == value["inputBytes"] and digest(body) == _hash(value.get("inputSha256")),
          "RESEARCH_QUOTE_RETAINED_INPUT_CHANGED")
    _object(body)


def _retained_file(value):
    _need(isinstance(value, dict) and isinstance(value.get("path"), str),
          "RESEARCH_QUOTE_FILE_REQUIRED")
    return _file_delivery({**value, "file": value["path"]})


def _file_descriptor(value):
    _need(isinstance(value, dict) and isinstance(value.get("name"), str) and
          _NAME.fullmatch(value["name"]) and type(value.get("bytes")) is int and
          0 <= value["bytes"] <= _FILE_LIMIT and isinstance(value.get("contentType"), str),
          "RESEARCH_QUOTE_EXPORT_FILE_CHANGED")
    _hash(value.get("sha256"))
    return value


class ResearchQuoteExport:
    """The native complete export, including every original selected file."""
    def __init__(self, result):
        self._record = _snapshot(result)
        _need(isinstance(self._record, dict) and self._record.get("schema") == _EXPORT and
              isinstance(self._record.get("workspaceId"), str) and
              _WORKSPACE.fullmatch(self._record["workspaceId"]),
              "RESEARCH_QUOTE_EXPORT_REQUIRED")
        _hash(self._record.get("selectionSha256"))
        directory = self._record.get("directory")
        _need(isinstance(directory, str) and Path(directory).is_absolute(),
              "RESEARCH_QUOTE_EXPORT_DIRECTORY_CHANGED")
        self.directory = Path(directory)
        selected, files = self._record.get("selection"), self._record.get("files")
        _need(isinstance(selected, dict) and isinstance(selected.get("files"), list) and
              isinstance(files, list) and len(files) <= 103 and
              len(files) == len(selected["files"]), "RESEARCH_QUOTE_EXPORT_FILES_CHANGED")
        self._files = {}
        for expected, file in zip(selected["files"], files):
            _file_descriptor(expected)
            _need(isinstance(file, dict) and
                  {key: item for key, item in file.items() if key != "path"} == expected and
                  file.get("path") == str(self.directory / "files" / expected["name"]) and
                  expected["name"] not in self._files, "RESEARCH_QUOTE_EXPORT_FILES_CHANGED")
            self._files[expected["name"]] = _retained_file(file)
        self.verify()

    @property
    def record(self):
        return deepcopy(self._record)

    @property
    def names(self):
        return tuple(self._files)

    def file(self, name):
        _need(name in self._files, "RESEARCH_QUOTE_EXPORT_FILE_UNKNOWN")
        return self._files[name]

    def verify(self):
        for file in self._files.values():
            with file.open():
                pass
        return {"workspaceId": self._record["workspaceId"],
                "selectionSha256": self._record["selectionSha256"],
                "directory": str(self.directory), "files": deepcopy(self._record["selection"]["files"])}


class ResearchQuoteBundle:
    """A portable original quote export; no Research server or Node process is needed.

    Use reopen() with the exact quote-export.json digest supplied by copy_export.
    The original native selection and every file are then verified in the new
    receiving directory.
    """
    def __init__(self, result):
        value = _snapshot(result)
        _need(isinstance(value, dict) and value.get("schema") == _COPY and
              isinstance(value.get("workspaceId"), str) and _WORKSPACE.fullmatch(value["workspaceId"]),
              "RESEARCH_QUOTE_BUNDLE_REQUIRED")
        root = value.get("directory")
        _need(isinstance(root, str) and Path(root).is_absolute(), "RESEARCH_QUOTE_BUNDLE_DIRECTORY_CHANGED")
        self.directory = private_directory(Path(root), create=False)
        descriptor = value.get("manifest")
        _need(isinstance(descriptor, dict) and
              descriptor.get("path") == str(self.directory / "quote-export.json"),
              "RESEARCH_QUOTE_BUNDLE_MANIFEST_CHANGED")
        self._manifest_file = _retained_file(descriptor)
        manifest = self._manifest_file.json(limit=_FILE_LIMIT)
        _need(isinstance(manifest, dict) and manifest.get("schema") == _EXPORT and
              manifest.get("workspaceId") == value["workspaceId"] and
              manifest.get("selectionSha256") == value.get("selectionSha256") and
              isinstance(manifest.get("selection"), dict) and
              isinstance(manifest.get("files"), list) and len(manifest["files"]) <= 103 and
              manifest["selection"].get("files") == manifest["files"],
              "RESEARCH_QUOTE_BUNDLE_MANIFEST_CHANGED")
        _hash(manifest["selectionSha256"])
        prior = parse(read(self.directory / "quote-export-selection.json", _FILE_LIMIT))
        _need(prior == {**manifest, "schema": "sf88-research-quote-export-copy/v1"},
              "RESEARCH_QUOTE_BUNDLE_SELECTION_CHANGED")
        self._files = {}
        for item in manifest["files"]:
            _file_descriptor(item)
            _need(item["name"] not in self._files and
                  item["name"] not in {"quote-export.json", "quote-export-selection.json"},
                  "RESEARCH_QUOTE_BUNDLE_FILES_CHANGED")
            self._files[item["name"]] = _retained_file({
                **item, "path": str(self.directory / item["name"])})
        self._record, self._manifest = value, manifest
        self.verify()

    @classmethod
    def reopen(cls, directory, *, expected_manifest_sha256):
        root = private_directory(Path(directory), create=False)
        body = read(root / "quote-export.json", _FILE_LIMIT)
        _need(digest(body) == _hash(expected_manifest_sha256), "RESEARCH_QUOTE_BUNDLE_MANIFEST_CHANGED")
        value = parse(body)
        _need(isinstance(value, dict), "RESEARCH_QUOTE_BUNDLE_MANIFEST_CHANGED")
        return cls({"schema": _COPY, "workspaceId": value.get("workspaceId"),
                    "selectionSha256": value.get("selectionSha256"), "directory": str(root),
                    "manifest": {"path": str(root / "quote-export.json"), "bytes": len(body),
                                 "sha256": expected_manifest_sha256}})

    @property
    def record(self):
        return deepcopy(self._record)

    @property
    def manifest(self):
        return deepcopy(self._manifest)

    @property
    def names(self):
        return tuple(self._files)

    def file(self, name):
        _need(name in self._files, "RESEARCH_QUOTE_EXPORT_FILE_UNKNOWN")
        return self._files[name]

    def verify(self):
        with self._manifest_file.open():
            pass
        _need(parse(read(self.directory / "quote-export-selection.json", _FILE_LIMIT)) ==
              {**self._manifest, "schema": "sf88-research-quote-export-copy/v1"},
              "RESEARCH_QUOTE_BUNDLE_SELECTION_CHANGED")
        for file in self._files.values():
            with file.open():
                pass
        return {"workspaceId": self._manifest["workspaceId"],
                "selectionSha256": self._manifest["selectionSha256"],
                "directory": str(self.directory), "manifest": deepcopy(self._record["manifest"]),
                "files": deepcopy(self._manifest["files"])}


class ResearchQuotes:
    """Complete quotations on the existing, retained ResearchWorkspace client."""
    def __init__(self, workspace: ResearchWorkspace):
        self.workspace = workspace

    def _decode(self, descriptor, action, selected, expected_workspace):
        _need(isinstance(descriptor, dict) and descriptor.get("schema") == _RESPONSE_FILE,
              "RESEARCH_QUOTES_PYTHON_RESPONSE_INVALID")
        _hash(descriptor.get("callSha256"))
        value = _snapshot(selected)
        _verify_selected_input(value)
        directory = Path(value.pop("responseDirectory"))
        file = descriptor.get("file")
        _need(isinstance(file, dict) and file.get("file") == str(directory / "response.json"),
              "RESEARCH_QUOTES_PYTHON_RESPONSE_FILE_CHANGED")
        body = _file_delivery(file).json(limit=_FILE_LIMIT)
        call = {"action": action, "input": value, "expectedWorkspaceId": expected_workspace}
        _need(isinstance(body, dict) and body.get("schema") == _RESPONSE and body.get("call") == call and
              body.get("callSha256") == descriptor["callSha256"] and
              body.get("workspaceId") == descriptor.get("workspaceId") and "result" in body,
              "RESEARCH_QUOTES_PYTHON_RESPONSE_CHANGED")
        identity = body.get("workspaceId")
        if action in _LOCAL:
            _need(identity is None, "RESEARCH_LOCAL_WORKSPACE_CHANGED")
        else:
            _need(isinstance(identity, str) and
                  (expected_workspace is None or identity == expected_workspace), "RESEARCH_WORKSPACE_CHANGED")
            self.workspace._bind(identity)
        result = deepcopy(body["result"])
        if isinstance(result, dict):
            for key in ("pythonRuntime", "sourceCleanupFailed"):
                if descriptor.get(key) is not None:
                    result[key] = deepcopy(descriptor[key])
        return result

    def _read(self, action, value=None, *, native_input=None, cancel_event=None, _owned_event=None):
        value = _snapshot(value or {})
        local = action in _LOCAL
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            with tempfile.TemporaryDirectory(prefix=".quotes-read-", dir=self.workspace.directory) as temporary:
                root = Path(temporary).resolve()
                if native_input is not None:
                    captured, _ = _retained_input(root / "input", value=native_input)
                    value.update(captured)
                selected = {**value, "responseDirectory": str(root / "response")}
                expected = None if local else self.workspace.workspace_id
                descriptor = self.workspace._read(action, selected, _owned_event=event, local=local)
                return self._decode(descriptor, action, selected, expected)

    def _write(self, action, value, *, call_id, resume=False, cancel_event=None, _owned_event=None):
        _need(action in _WRITES, "RESEARCH_QUOTES_ACTION_INVALID")
        value = _snapshot(value)
        _need(len(_json(value)) <= _CONTROL_LIMIT, "RESEARCH_QUOTES_PYTHON_CONTROL_TOO_LARGE")
        local = action in _LOCAL
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            if self.workspace.workspace_id is None and not local:
                self.workspace._read("status", _owned_event=event)
            directory = self.workspace._directory_for_call(_request_id(call_id), create=True)
            selected = {**value, "directory": value.get("directory", str(directory / "quote-operation")),
                        "responseDirectory": str(directory / "quote-response")}
            expected = None if local else self.workspace.workspace_id
            descriptor = self.workspace._write_call(action, selected, request_id=call_id,
                replay_safe=True, resume=resume, event=event, local=local)
            return self._verify_completed(action, self._decode(descriptor, action, selected, expected))

    @staticmethod
    def _verify_completed(action, result):
        if action in {"quotes-submit", "quotes-replay"}:
            _need(isinstance(result, dict) and result.get("schema") == _OPERATOR and
                  isinstance(result.get("result"), dict), "RESEARCH_QUOTE_OPERATOR_RESULT_CHANGED")
        elif action in {"quotes-export-operation", "quotes-export-case", "quotes-export-tariff"}:
            ResearchQuoteExport(result)
        elif action == "quotes-copy-export":
            ResearchQuoteBundle(result)
        elif action == "quotes-download":
            _need(isinstance(result, dict) and result.get("schema") == _DOWNLOAD and
                  isinstance(result.get("metadata"), dict), "RESEARCH_QUOTE_DOWNLOAD_CHANGED")
            descriptor = _file_descriptor(result["metadata"].get("descriptor"))
            file = result.get("file")
            _need(isinstance(file, dict) and file.get("bytes") == descriptor["bytes"] and
                  file.get("sha256") == descriptor["sha256"], "RESEARCH_QUOTE_DOWNLOAD_CHANGED")
            with _retained_file(file).open():
                pass
        return result

    def configuration(self, *, cancel_event=None) -> QuoteConfiguration:
        return self._read("quotes-configuration", cancel_event=cancel_event)

    def cases(self, *, q=None, status=None, due_on=None, offset=0, limit=50, cancel_event=None):
        _need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
              "RESEARCH_QUOTE_CASE_PAGE_INVALID")
        options = {"offset": offset, "limit": limit}
        for key, value in (("q", q), ("status", status), ("dueOn", due_on)):
            if value is not None:
                _need(isinstance(value, str), "RESEARCH_QUOTE_CASE_QUERY_INVALID")
                options[key] = value
        return self._read("quotes-cases", {"options": options}, cancel_event=cancel_event)

    def case(self, case_id, *, revision=None, cancel_event=None):
        options = {} if revision is None else {"revision": _hash(revision)}
        return self._read("quotes-case", {"caseId": _id(case_id), "options": options},
                          cancel_event=cancel_event)

    def list(self, *, offset=0, limit=50, snapshot=None, dossier_id=None, kind=None, cancel_event=None):
        _need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100 and
              (offset == 0 or snapshot is not None), "RESEARCH_QUOTE_PAGE_INVALID")
        options = {"offset": offset, "limit": limit}
        if snapshot is not None:
            options["snapshot"] = _hash(snapshot)
        if dossier_id is not None:
            options["dossierId"] = dossier_id
        if kind is not None:
            _need(kind in KINDS, "RESEARCH_QUOTE_KIND_INVALID")
            options["kind"] = kind
        return self._read("quotes-list", {"options": options}, cancel_event=cancel_event)

    def iter_pages(self, *, limit=100, dossier_id=None, kind=None, cancel_event=None) -> Iterator[dict[str, Any]]:
        """Keep the original snapshot and every native row/error page."""
        offset, total, snapshot = 0, None, None
        while True:
            page = self.list(offset=offset, limit=limit, snapshot=snapshot,
                             dossier_id=dossier_id, kind=kind, cancel_event=cancel_event)
            _need((snapshot is None or page["snapshot"] == snapshot) and
                  (total is None or page["total"] == total), "RESEARCH_QUOTE_PAGE_CHANGED")
            snapshot, total = page["snapshot"], page["total"]
            yield deepcopy(page)
            following = page["nextOffset"]
            if following is None:
                return
            _need(type(following) is int and following > offset and following <= total,
                  "RESEARCH_QUOTE_PAGE_CHANGED")
            offset = following

    def operation(self, operation_id, *, cancel_event=None) -> QuoteOperation:
        return self._read("quotes-operation", {"id": _id(operation_id)}, cancel_event=cancel_event)

    def files(self, operation_id, *, cancel_event=None):
        return self._read("quotes-files", {"id": _id(operation_id)}, cancel_event=cancel_event)

    def file_info(self, operation_id, name, *, cancel_event=None):
        return self._read("quotes-file-info", {"id": _id(operation_id), "name": name},
                          cancel_event=cancel_event)

    def case_file_info(self, case_id, value, *, tariff=False, cancel_event=None):
        _need(type(tariff) is bool, "RESEARCH_QUOTE_EXPORT_KIND_REQUIRED")
        return self._read("quotes-tariff-file-info" if tariff else "quotes-case-file-info",
                          {"caseId": _id(case_id)}, native_input=value, cancel_event=cancel_event)

    def submit(self, command, value, *, call_id=None, case_id=None, action=None, profile=None,
               resume=False, cancel_event=None) -> QuoteOperatorResult:
        """Retain the complete original JSON and submit it to the native operator."""
        _need(command in COMMANDS, "RESEARCH_QUOTE_COMMAND_INVALID")
        captured = _snapshot(value)
        _need(isinstance(captured, dict), "RESEARCH_QUOTE_FIELDS_INVALID")
        if call_id is None:
            _need(command not in {"native-case", "pricing"}, "RESEARCH_QUOTE_CALL_ID_REQUIRED")
            native_id = captured.get("requestId") or captured.get("id")
            call_id = "quotes-" + command + ":" + _id(native_id)
        with self.workspace._operation(cancel_event) as event:
            root = self.workspace._directory_for_call(_request_id(call_id), create=True)
            selected, _ = _retained_input(root / "quote-input", value=captured)
            selected["command"] = command
            for key, item in (("caseId", case_id), ("action", action), ("profile", profile)):
                if item is not None:
                    selected[key] = item
            return self._write("quotes-submit", selected, call_id=call_id, resume=resume, _owned_event=event)

    def submit_file(self, command, source, *, call_id, expected_input_sha256=None,
                    case_id=None, action=None, profile=None, resume=False, cancel_event=None):
        """Receive raw JSON unchanged, including full commercial backup inputs.

        Once retained, the original donor can be absent. A present donor must
        still contain the first selected bytes. Native request IDs are never
        generated or replaced by this call.
        """
        _need(command in COMMANDS, "RESEARCH_QUOTE_COMMAND_INVALID")
        with self.workspace._operation(cancel_event) as event:
            root = self.workspace._directory_for_call(_request_id(call_id), create=True)
            selected, _ = _retained_input(root / "quote-input", source=source,
                                         expected_sha256=expected_input_sha256)
            selected["command"] = command
            for key, item in (("caseId", case_id), ("action", action), ("profile", profile)):
                if item is not None:
                    selected[key] = item
            return self._write("quotes-submit", selected, call_id=call_id, resume=resume, _owned_event=event)

    def create_case(self, value: QuoteCaseSelection, **options) -> QuoteOperatorResult:
        return self.submit("create-case", value, **options)

    def prepare(self, value: QuoteBriefSelection, **options) -> QuoteOperatorResult:
        return self.submit("prepare", value, **options)

    def prepare_response(self, value: QuoteResponseSelection, **options) -> QuoteOperatorResult:
        return self.submit("prepare-response", value, **options)

    def apply(self, value: QuoteApplySelection, **options) -> QuoteOperatorResult:
        return self.submit("apply", value, **options)

    def prepare_publication(self, value: QuotePublicationSelection, **options) -> QuoteOperatorResult:
        return self.submit("prepare-publication", value, **options)

    def enroll_publication(self, value: QuoteApplySelection, **options) -> QuoteOperatorResult:
        return self.submit("enroll-publication", value, **options)

    def prepare_report(self, value: QuoteReportSelection, **options) -> QuoteOperatorResult:
        return self.submit("prepare-report", value, **options)

    def case_action(self, case_id, action, value, *, call_id, **options):
        _need(action in CASE_ACTIONS, "RESEARCH_QUOTE_CASE_ACTION_REQUIRED")
        return self.submit("native-case", value, case_id=_id(case_id), action=action,
                           call_id=call_id, **options)

    def pricing(self, profile, action, value, *, call_id, **options):
        _need(action in PRICING_ACTIONS, "RESEARCH_QUOTE_PRICING_ACTION_REQUIRED")
        return self.submit("pricing", value, profile=profile, action=action, call_id=call_id, **options)

    def export_operation(self, operation_id, *, call_id, expected_operation_sha256=None,
                         resume=False, cancel_event=None) -> QuoteExportResult:
        selected = {"id": _id(operation_id)}
        if expected_operation_sha256 is not None:
            selected["expectedOperationSha256"] = _hash(expected_operation_sha256)
        return self._write("quotes-export-operation", selected, call_id=call_id,
                           resume=resume, cancel_event=cancel_event)

    def export_case(self, case_id, value=None, *, call_id, input_file=None,
                    expected_input_sha256=None, expected_sha256=None, expected_bytes=None,
                    tariff=False, resume=False, cancel_event=None) -> QuoteExportResult:
        """Freeze the original revision/file metadata before the native transfer."""
        _id(case_id)
        _need(type(tariff) is bool, "RESEARCH_QUOTE_EXPORT_KIND_REQUIRED")
        if expected_sha256 is not None:
            _hash(expected_sha256)
        if expected_bytes is not None:
            _need(type(expected_bytes) is int and 0 <= expected_bytes <= _FILE_LIMIT,
                  "RESEARCH_QUOTE_FILE_SIZE_INVALID")
        with self.workspace._operation(cancel_event) as event:
            root = self.workspace._directory_for_call(_request_id(call_id), create=True)
            selected, _ = _retained_input(root / "quote-input", value=value, source=input_file,
                                         expected_sha256=expected_input_sha256)
            selected["caseId"] = case_id
            if expected_sha256 is not None:
                selected["expectedSha256"] = expected_sha256
            if expected_bytes is not None:
                selected["expectedBytes"] = expected_bytes
            return self._write("quotes-export-tariff" if tariff else "quotes-export-case",
                               selected, call_id=call_id, resume=resume, _owned_event=event)

    def download(self, operation_id, name, *, expected_sha256, expected_bytes, call_id,
                 resume=False, cancel_event=None):
        """Receive the complete single original file under its metadata promise."""
        _need(type(expected_bytes) is int and 0 <= expected_bytes <= _FILE_LIMIT,
              "RESEARCH_QUOTE_FILE_SIZE_INVALID")
        return self._write("quotes-download", {"id": _id(operation_id), "name": name,
            "expectedSha256": _hash(expected_sha256), "expectedBytes": expected_bytes},
            call_id=call_id, resume=resume, cancel_event=cancel_event)

    @staticmethod
    def downloaded_file(result):
        ResearchQuotes._verify_completed("quotes-download", result)
        return _retained_file(result["file"])

    @staticmethod
    def exported_files(result):
        return ResearchQuoteExport(result)

    def copy_export(self, call_id, directory, *, copy_id, resume=False, cancel_event=None):
        """Use the original native publisher to create a complete portable directory."""
        _request_id(call_id); _request_id(copy_id)
        _need(call_id != copy_id, "RESEARCH_QUOTE_DISTINCT_COPY_CALL_REQUIRED")
        with self.workspace._operation(cancel_event) as event:
            saved = self.saved(call_id)
            _need(saved.get("completed") is True and
                  saved["request"]["action"] in {"quotes-export-operation", "quotes-export-case", "quotes-export-tariff"},
                  "RESEARCH_QUOTE_COMPLETE_EXPORT_REQUIRED")
            result = saved["result"]
            selected = {"sourceDirectory": result["directory"], "directory": _absolute(directory),
                        "expectedSelectionSha256": result["selectionSha256"],
                        "expectedWorkspaceId": result["workspaceId"]}
            return self._write("quotes-copy-export", selected, call_id=copy_id,
                               resume=resume, _owned_event=event)

    def saved(self, call_id):
        """Read and verify the first complete reply without contacting a host."""
        saved = self.workspace.call_record(_request_id(call_id))
        request, record = saved["request"], saved.get("result")
        _need(request.get("action") in _WRITES and request.get("replaySafe") is True,
              "RESEARCH_QUOTE_SAVED_CALL_REQUIRED")
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
        """Continue the same recorded action and complete original input."""
        saved = self.workspace.call_record(_request_id(call_id))["request"]
        _need(saved.get("action") in _WRITES and saved.get("replaySafe") is True,
              "RESEARCH_QUOTE_SAVED_CALL_REQUIRED")
        with self.workspace._operation(cancel_event) as event:
            descriptor = self.workspace._write_call(saved["action"], saved["input"],
                request_id=call_id, replay_safe=True, resume=True, event=event,
                local=saved.get("local", False))
            return self._verify_completed(saved["action"],
                self._decode(descriptor, saved["action"], saved["input"], saved["workspaceId"]))

    def replay(self, call_id, *, replay_id, cancel_event=None):
        """Explicitly replay the same original request in a separate local attempt.

        The replay can finish an interrupted original write. Its native UUID,
        input bytes, case scope, source selections and review SHA stay unchanged.
        """
        _request_id(call_id); _request_id(replay_id)
        _need(call_id != replay_id, "RESEARCH_QUOTE_DISTINCT_REPLAY_CALL_REQUIRED")
        with self.workspace._operation(cancel_event) as event:
            original = self.workspace.call_record(call_id)["request"]
            _need(original.get("action") in {"quotes-submit", "quotes-replay"} and
                  original.get("replaySafe") is True, "RESEARCH_QUOTE_REPLAY_SOURCE_REQUIRED")
            selected = original["input"]
            source_directory = selected["directory"]
            native = (deepcopy(selected["original"]) if original["action"] == "quotes-replay" else
                      {key: deepcopy(selected[key]) for key in
                       ("command", "caseId", "action", "profile", "inputFile", "inputSha256", "inputBytes")
                       if key in selected})
            native["workspaceId"] = original["workspaceId"]
            value = {"sourceDirectory": source_directory, "original": native}
            return self._write("quotes-replay", value, call_id=replay_id, resume=True, _owned_event=event)

    def inspect_run(self, call_id, *, cancel_event=None):
        """Read the original native request, attempts, selection and complete files."""
        original = self.workspace.call_record(_request_id(call_id))["request"]
        _need(original.get("action") in _WRITES - {"quotes-copy-export", "quotes-download"},
              "RESEARCH_QUOTE_OPERATOR_CALL_REQUIRED")
        return self._read("quotes-run-inspect", {"directory": original["input"]["directory"]},
                          cancel_event=cancel_event)
