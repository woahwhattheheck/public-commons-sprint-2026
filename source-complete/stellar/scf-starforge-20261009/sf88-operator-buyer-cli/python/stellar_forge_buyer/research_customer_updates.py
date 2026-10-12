"""Recurring customer delivery on the original Research workspace.

The native dossier owns all project, request, work and delivery history. This
client borrows ResearchWorkspace's admission, request journal and Node runtime.
Complete JSON replies and exports use the original verified file reader.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
import tempfile
from typing import Any, Iterator, TYPE_CHECKING

from .errors import StateError
from .research_workspace import _file_delivery, _json, _request_id
from .storage import digest, parse, read, write

if TYPE_CHECKING:
    from .research_workspace import ResearchWorkspace
    from .research_customer_types import CustomerUpdateRequest, CustomerPreparedRequest

ACTIONS = ("create-project", "revise-brief", "record-agreement", "request-update",
           "revise-request", "attach-intake", "review-work", "publish-delivery",
           "record-delivery", "set-project-status")
SECTIONS = ("overview", "projects", "briefs", "agreements", "requests", "intakes",
            "work", "deliveries", "delivery-events", "operations", "records",
            "editions", "questions")
PREVIEW_SECTIONS = ("overview", "changes", "sources", "records", "intakes",
                    "editions", "uncovered-plans")
FORMATS = ("json", "md", "html", "csv", "portable", "portable.gz")
_PREPARED = "sf88-research-customer-python-prepared/v1"
_RESPONSE = "sf88-research-customer-python-response/v1"
_RESPONSE_FILE = "sf88-research-customer-python-file/v1"
_LIMIT = 16 * 1024 * 1024
_RESPONSE_LIMIT = 96 * 1024 * 1024 + 65536
_DOSSIER = re.compile(r"d_[a-f0-9-]{36}")
_HASH = re.compile(r"[a-f0-9]{64}")
_REQUEST = re.compile(r"[A-Za-z0-9_-]{8,100}")
_CUSTOMER_WRITES = {"customer-update-submit", "customer-update-export",
                    "customer-handover-create", "customer-handover-receive", "customer-delivery-programme",
                    "customer-update-replay"}


def _need(value, code):
    if not value:
        raise StateError(code)


def _snapshot(value):
    return parse(_json(value))


def _absolute(value):
    return str(Path(value).expanduser().absolute())


def _revision(value, *, optional=True):
    _need(optional and value is None or type(value) is int and 1 <= value < 100000000,
          "EXPECTED_REVISION_REQUIRED")
    return value


def _hash(value):
    _need(isinstance(value, str) and _HASH.fullmatch(value),
          "CUSTOMER_UPDATE_SHA256_REQUIRED")
    return value


def _page_options(section, sections, revision, offset, limit):
    _need(section in sections and type(offset) is int and offset >= 0 and
          type(limit) is int and 1 <= limit <= 100 and (offset == 0 or revision is not None),
          "CUSTOMER_UPDATE_PAGE_INVALID")
    _revision(revision)
    return {"section": section, "offset": offset, "limit": limit,
            **({"revision": revision} if revision is not None else {})}


def _json_file(value, expected):
    _need(isinstance(value, dict) and value.get("file") == str(expected),
          "RESEARCH_CUSTOMER_RESPONSE_FILE_CHANGED")
    delivery = _file_delivery(value)
    return delivery.json(limit=_RESPONSE_LIMIT)


def _retained_json(path, value, limit=_LIMIT + 65536):
    """Use the existing complete-file publisher; never replace another form."""
    value = _snapshot(value)
    body = _json(value) + b"\n"
    _need(len(body) <= limit, "CUSTOMER_UPDATE_RETAINED_FORM_TOO_LARGE")
    if path.exists() or path.is_symlink():
        _need(parse(read(path, limit)) == value, "CUSTOMER_UPDATE_RETAINED_FORM_CHANGED")
    else:
        try:
            write(path, body, exclusive=True)
        except FileExistsError:
            _need(parse(read(path, limit)) == value, "CUSTOMER_UPDATE_RETAINED_FORM_CHANGED")
    return value


class ResearchCustomerDelivery:
    """All four reports, reviewed work and complete editable native dossier.

    The native compiler/portable inspector supplies the manifest. Reopening this
    saved result checks every original byte through FileDelivery and needs no
    running workspace. The optional source-workspace archive is retained too.
    """
    def __init__(self, inspected):
        value = _snapshot(inspected)
        _need(isinstance(value, dict) and
              value.get("schema") == "sf88-research-customer-handover-inspected/v1",
              "CUSTOMER_UPDATE_HANDOVER_REQUIRED")
        self._value = value
        self.directory = Path(value["directory"]).expanduser().absolute()
        _need(self.directory.is_absolute() and isinstance(value.get("manifest"), dict),
              "CUSTOMER_UPDATE_HANDOVER_REQUIRED")
        _hash(value.get("manifestSha256"))
        self.verify()

    @property
    def inspected(self):
        return deepcopy(self._value)

    @property
    def manifest(self):
        return deepcopy(self._value["manifest"])

    @property
    def manifest_sha256(self):
        return self._value["manifestSha256"]

    @property
    def selection(self):
        return deepcopy(self._value["manifest"]["selection"])

    @property
    def files(self):
        return deepcopy(self._value["manifest"]["files"])

    def _member(self, row):
        name = row.get("name")
        _need(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,179}", name),
              "CUSTOMER_UPDATE_HANDOVER_FILENAME_INVALID")
        return _file_delivery({"file": str(self.directory / name), "bytes": row["bytes"],
                               "sha256": row["sha256"],
                               "contentType": row.get("contentType", "application/octet-stream")})

    def verify(self):
        original = _file_delivery({"file": str(self.directory / "handover.json"),
            "bytes": self._value["manifestBytes"], "sha256": self.manifest_sha256,
            "contentType": "application/json; charset=utf-8"}).json(limit=64 * 1024 * 1024)
        _need(original == self._value["manifest"] and
              original.get("schema") == "sf88-research-customer-handover/v1" and
              original.get("selection") == self._value.get("selection"),
              "CUSTOMER_UPDATE_HANDOVER_MANIFEST_CHANGED")
        rows = original.get("files")
        _need(isinstance(rows, list) and len(rows) in (6, 7) and
              len({row.get("name") for row in rows}) == len(rows),
              "CUSTOMER_UPDATE_HANDOVER_FILES_INVALID")
        _need({row.get("format") for row in rows if row.get("kind") == "report"} ==
              {"json", "md", "html", "csv"} and
              sum(row.get("kind") == "work" for row in rows) == 1 and
              sum(row.get("kind") == "dossier" for row in rows) == 1 and
              sum(row.get("kind") == "europe-pmc" for row in rows) == len(rows) - 6,
              "CUSTOMER_UPDATE_HANDOVER_FILES_INVALID")
        for row in rows:
            with self._member(row).open():
                pass
        return {"manifestSha256": self.manifest_sha256, "files": len(rows),
                "bytes": sum(row["bytes"] for row in rows),
                "dossierId": original["selection"]["dossierId"],
                "deliveryId": original["selection"]["delivery"]["id"]}

    def file(self, name):
        row = next((row for row in self.files if row["name"] == name), None)
        _need(row is not None, "CUSTOMER_UPDATE_HANDOVER_FILE_NOT_FOUND")
        return self._member(row)

    def report(self, format):
        _need(format in ("json", "md", "html", "csv"), "CUSTOMER_UPDATE_REPORT_FORMAT_INVALID")
        row = next(row for row in self.files if row.get("kind") == "report" and row.get("format") == format)
        return self._member(row)

    def work(self):
        return self._member(next(row for row in self.files if row["kind"] == "work"))

    def dossier(self):
        return self._member(next(row for row in self.files if row["kind"] == "dossier"))

    def source_workspace(self):
        row = next((row for row in self.files if row["kind"] == "europe-pmc"), None)
        return self._member(row) if row else None

    @classmethod
    def from_received(cls, received):
        """Reopen the exact input which the original receiving operation saved."""
        _need(isinstance(received, dict) and
              received.get("schema") == "sf88-research-customer-receiving-result/v1",
              "CUSTOMER_UPDATE_RECEIVING_RESULT_REQUIRED")
        directory = Path(received["directory"]) / "input"
        path = directory / "handover.json"
        body = read(path, 64 * 1024 * 1024)
        _need(digest(body) == received["manifestSha256"], "CUSTOMER_UPDATE_HANDOVER_MANIFEST_CHANGED")
        manifest = parse(body)
        selected = manifest.get("selection", {})
        _need(selected.get("dossierId") == received["dossierId"] and
              selected.get("projectId") == received["projectId"] and
              selected.get("delivery", {}).get("id") == received["deliveryId"],
              "CUSTOMER_UPDATE_RECEIVING_RESULT_CHANGED")
        return cls({"schema": "sf88-research-customer-handover-inspected/v1",
                    "directory": str(directory), "manifestSha256": digest(body),
                    "manifestBytes": len(body), "manifest": manifest,
                    "selection": selected, "files": manifest["files"]})


class ResearchCustomerUpdates:
    """One dossier in an existing, identity-bound ResearchWorkspace."""
    def __init__(self, workspace: ResearchWorkspace, dossier_id: str):
        _need(isinstance(dossier_id, str) and _DOSSIER.fullmatch(dossier_id),
              "CUSTOMER_UPDATE_DOSSIER_REQUIRED")
        self.workspace, self.dossier_id = workspace, dossier_id

    def _decode(self, descriptor, action, value, expected_workspace):
        _need(isinstance(descriptor, dict) and descriptor.get("schema") == _RESPONSE_FILE,
              "RESEARCH_CUSTOMER_RESPONSE_INVALID")
        _hash(descriptor.get("callSha256"))
        selected = _snapshot(value)
        directory = Path(selected.pop("responseDirectory"))
        body = _json_file(descriptor.get("file"), directory / "response.json")
        call = {"action": action, "input": selected, "expectedWorkspaceId": expected_workspace}
        _need(isinstance(body, dict) and body.get("schema") == _RESPONSE and
              body.get("call") == call and body.get("callSha256") == descriptor["callSha256"] and
              body.get("workspaceId") == descriptor.get("workspaceId"),
              "RESEARCH_CUSTOMER_RESPONSE_CHANGED")
        identity = body.get("workspaceId")
        if identity is not None:
            _need(expected_workspace is None or identity == expected_workspace,
                  "RESEARCH_WORKSPACE_CHANGED")
            self.workspace._bind(identity)
        result = deepcopy(body["result"])
        if isinstance(result, dict):
            for field in ("pythonRuntime", "sourceCleanupFailed"):
                if descriptor.get(field) is not None:
                    result[field] = deepcopy(descriptor[field])
        return result

    def _read(self, action, value, *, cancel_event=None, _owned_event=None):
        value = _snapshot(value)
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            with tempfile.TemporaryDirectory(prefix=".customer-read-", dir=self.workspace.directory) as temporary:
                selected = {**value, "responseDirectory": str(Path(temporary).resolve())}
                expected = self.workspace.workspace_id
                descriptor = self.workspace._read(action, selected, _owned_event=event)
                return self._decode(descriptor, action, selected, expected)

    def _write(self, action, value, *, request_id, resume=False, cancel_event=None,
               _owned_event=None):
        _need(action in _CUSTOMER_WRITES, "CUSTOMER_UPDATE_ACTION_INVALID")
        value = _snapshot(value)
        with self.workspace._operation(cancel_event, owned_event=_owned_event) as event:
            if self.workspace.workspace_id is None:
                self.workspace._read("status", _owned_event=event)
            directory = self.workspace._directory_for_call(_request_id(request_id), create=True)
            selected = {**value,
                        "directory": value.get("directory", str(directory / "customer-operation")),
                        "responseDirectory": str(directory / "customer-response")}
            expected = self.workspace.workspace_id
            descriptor = self.workspace._write_call(action, selected, request_id=request_id,
                replay_safe=True, resume=resume, event=event)
            result = self._decode(descriptor, action, selected, expected)
            return self._verify_completed(action, result)

    @staticmethod
    def _verify_completed(action, result):
        if action == "customer-handover-create":
            ResearchCustomerDelivery(result)
        elif action == "customer-handover-receive":
            ResearchCustomerDelivery.from_received(result)
        elif action == "customer-delivery-programme":
            for key in ("delivery", "correctionDelivery"):
                selected = result[key]
                manifest = Path(selected["directory"]) / "handover.json"
                body = read(manifest, 64 * 1024 * 1024)
                _need(digest(body) == selected["manifestSha256"], "CUSTOMER_UPDATE_HANDOVER_MANIFEST_CHANGED")
                value = parse(body)
                ResearchCustomerDelivery({"schema": "sf88-research-customer-handover-inspected/v1",
                    "directory": str(manifest.parent), "manifestBytes": len(body),
                    "manifestSha256": digest(body), "manifest": value, "selection": value["selection"]})
        elif action == "customer-update-export":
            file = result["file"]
            with _file_delivery({**file, "file": file["path"]}).open():
                pass
        return result

    def read(self, *, section="overview", project_id=None, cycle_id=None,
             revision=None, offset=0, limit=30, query=None, cancel_event=None):
        options = _page_options(section, SECTIONS, revision, offset, limit)
        for key, value in (("projectId", project_id), ("cycleId", cycle_id), ("query", query)):
            if value is not None:
                options[key] = value
        return self._read("customer-updates", {"dossierId": self.dossier_id, "options": options},
                          cancel_event=cancel_event)

    def iter_rows(self, *, section, project_id=None, cycle_id=None, revision=None,
                  limit=100, query=None, cancel_event=None) -> Iterator[dict[str, Any]]:
        """Every page retains the first native revision, row count and cursor."""
        _need(section != "overview", "CUSTOMER_UPDATE_ROWS_SECTION_REQUIRED")
        offset, total = 0, None
        while True:
            page = self.read(section=section, project_id=project_id, cycle_id=cycle_id,
                revision=revision, offset=offset, limit=limit, query=query, cancel_event=cancel_event)
            _need((revision is None or page["revision"] == revision) and
                  (total is None or page["total"] == total), "CUSTOMER_UPDATE_PAGE_CHANGED")
            revision, total = page["revision"], page["total"]
            yield from deepcopy(page["items"])
            following = page["nextOffset"]
            if following is None:
                return
            _need(type(following) is int and following > offset, "CUSTOMER_UPDATE_PAGE_CHANGED")
            offset = following

    def record(self, path, *, sha256=None, label=None, revision=None, cancel_event=None):
        _revision(revision)
        selected = {"path": path}
        for key, value in (("sha256", sha256), ("label", label), ("revision", revision)):
            if value is not None:
                selected[key] = value
        return self._read("customer-update-record", {"dossierId": self.dossier_id, "input": selected},
                          cancel_event=cancel_event)

    def preview(self, *, project_id, cycle_id, request_edition_id, selection,
                revision=None, section="overview", offset=0, limit=30, fingerprint=None,
                cancel_event=None):
        selected = _page_options(section, PREVIEW_SECTIONS, revision, offset, limit)
        selected.update({"projectId": project_id, "cycleId": cycle_id,
                         "requestEditionId": request_edition_id, "selection": _snapshot(selection)})
        if fingerprint is not None:
            selected["fingerprint"] = _hash(fingerprint)
        return self._read("customer-update-preview", {"dossierId": self.dossier_id, "input": selected},
                          cancel_event=cancel_event)

    def iter_preview(self, *, section, project_id, cycle_id, request_edition_id, selection,
                     revision=None, fingerprint=None, limit=100, cancel_event=None):
        _need(section != "overview", "CUSTOMER_UPDATE_ROWS_SECTION_REQUIRED")
        offset, total = 0, None
        selection = _snapshot(selection)
        while True:
            page = self.preview(project_id=project_id, cycle_id=cycle_id,
                request_edition_id=request_edition_id, selection=selection, revision=revision,
                section=section, offset=offset, limit=limit, fingerprint=fingerprint,
                cancel_event=cancel_event)
            _need((revision is None or page["revision"] == revision) and
                  (fingerprint is None or page["fingerprint"] == fingerprint) and
                  (total is None or page["total"] == total), "CUSTOMER_UPDATE_CONTEXT_CHANGED")
            revision, fingerprint, total = page["revision"], page["fingerprint"], page["total"]
            yield from deepcopy(page["items"])
            following = page["nextOffset"]
            if following is None:
                return
            _need(type(following) is int and following > offset, "CUSTOMER_UPDATE_PAGE_CHANGED")
            offset = following

    def work(self, work_id, *, revision=None, section="overview", offset=0, limit=30,
             cancel_event=None):
        selected = _page_options(section, PREVIEW_SECTIONS, revision, offset, limit)
        selected["workId"] = work_id
        return self._read("customer-update-work", {"dossierId": self.dossier_id, "input": selected},
                          cancel_event=cancel_event)

    def iter_work(self, work_id, *, section, revision=None, limit=100, cancel_event=None):
        _need(section != "overview", "CUSTOMER_UPDATE_ROWS_SECTION_REQUIRED")
        offset, total, fingerprint, frozen_revision = 0, None, None, None
        while True:
            page = self.work(work_id, revision=revision, section=section, offset=offset,
                             limit=limit, cancel_event=cancel_event)
            _need((revision is None or page["workspaceRevision"] == revision) and
                  (frozen_revision is None or page["revision"] == frozen_revision) and
                  (fingerprint is None or page["fingerprint"] == fingerprint) and
                  (total is None or page["total"] == total), "CUSTOMER_UPDATE_WORK_CHANGED")
            revision, frozen_revision = page["workspaceRevision"], page["revision"]
            total, fingerprint = page["total"], page["fingerprint"]
            yield from deepcopy(page["items"])
            following = page["nextOffset"]
            if following is None:
                return
            _need(type(following) is int and following > offset, "CUSTOMER_UPDATE_PAGE_CHANGED")
            offset = following

    def europe_pmc_plan(self, *, query_id, query_revision, question_id, plan_id,
                        name=None, constraints=None, library=None, cancel_event=None):
        """Derive a brief plan from the original retained Europe PMC query."""
        selected = {"queryId": query_id, "queryRevision": query_revision,
                    "questionId": question_id, "planId": plan_id}
        for key, value in (("name", name), ("constraints", constraints), ("library", library)):
            if value is not None:
                selected[key] = value
        return self._read("customer-update-plan", {"input": selected}, cancel_event=cancel_event)

    def validate(self, request, *, cancel_event=None, _owned_event=None):
        _need(isinstance(request, dict) and len(_json(request)) <= _LIMIT,
              "CUSTOMER_UPDATE_REQUEST_TOO_LARGE")
        return self._read("customer-update-input", {"request": _snapshot(request)},
                          cancel_event=cancel_event, _owned_event=_owned_event)

    def prepare(self, action, data, *, request_id, actor, expected_revision=None,
                cancel_event=None):
        """Select one original revision now; submit and retry keep it unchanged."""
        _need(action in ACTIONS and isinstance(data, dict), "CUSTOMER_UPDATE_ACTION_INVALID")
        data, actor = _snapshot(data), _snapshot(actor)
        with self.workspace._operation(cancel_event) as event:
            if self.workspace.workspace_id is None:
                self.workspace._read("status", _owned_event=event)
            if expected_revision is None:
                expected_revision = self._read("customer-updates", {
                    "dossierId": self.dossier_id, "options": {"section": "overview"}}, _owned_event=event)["revision"]
            normalized = self.validate({"requestId": request_id, "expectedRevision": expected_revision,
                "actor": actor, "action": action, "data": data}, _owned_event=event)
            return {"schema": _PREPARED, "workspaceId": self.workspace.workspace_id,
                    "dossierId": self.dossier_id, **normalized}

    def save_prepared(self, prepared, file, *, cancel_event=None):
        selected = _snapshot(prepared)
        _need(selected.get("schema") == _PREPARED and selected.get("dossierId") == self.dossier_id,
              "CUSTOMER_UPDATE_PREPARED_CHANGED")
        normalized = self.validate(selected.get("request"), cancel_event=cancel_event)
        _need(normalized["request"] == selected.get("request") and
              normalized["sha256"] == selected.get("sha256"), "CUSTOMER_UPDATE_PREPARED_CHANGED")
        destination = Path(file).expanduser().absolute()
        _retained_json(destination, selected)
        body = read(destination, _LIMIT + 65536)
        return _file_delivery({"file": str(destination), "bytes": len(body), "sha256": digest(body),
                               "contentType": "application/json; charset=utf-8"})

    def submit_prepared(self, prepared, *, resume=False, cancel_event=None):
        if isinstance(prepared, (str, Path)):
            prepared = parse(read(Path(prepared).expanduser().absolute(), _LIMIT + 65536))
        selected = _snapshot(prepared)
        _need(selected.get("schema") == _PREPARED and selected.get("dossierId") == self.dossier_id,
              "CUSTOMER_UPDATE_PREPARED_CHANGED")
        with self.workspace._operation(cancel_event) as event:
            if self.workspace.workspace_id is None:
                self.workspace._read("status", _owned_event=event)
            _need(selected.get("workspaceId") == self.workspace.workspace_id,
                  "CUSTOMER_UPDATE_PREPARED_WORKSPACE_CHANGED")
            normalized = self.validate(selected.get("request"), _owned_event=event)
            _need(normalized["request"] == selected.get("request") and
                  normalized["sha256"] == selected.get("sha256"), "CUSTOMER_UPDATE_PREPARED_CHANGED")
            return self._submit(normalized["request"], resume=resume, event=event)

    def _submit(self, request, *, resume, event):
        _need(isinstance(request.get("requestId"), str) and _REQUEST.fullmatch(request["requestId"]),
              "CUSTOMER_UPDATE_REQUEST_ID_REQUIRED")
        return self._write("customer-update-submit",
            {"dossierId": self.dossier_id, "input": request}, request_id=request["requestId"],
            resume=resume, _owned_event=event)

    def submit(self, request: CustomerUpdateRequest, *, resume=False, cancel_event=None):
        """Save the full exact request before the original native writer runs."""
        with self.workspace._operation(cancel_event) as event:
            normalized = self.validate(request, _owned_event=event)["request"]
            return self._submit(normalized, resume=resume, event=event)

    def submit_file(self, file, *, expected_sha256=None, resume=False, cancel_event=None):
        """Retain exact caller bytes before submission; recovery uses that copy."""
        selected = Path(file).expanduser().absolute()
        body = read(selected, _LIMIT)
        if expected_sha256 is not None:
            _need(digest(body) == _hash(expected_sha256), "CUSTOMER_UPDATE_INPUT_FILE_CHANGED")
        request = parse(body)
        _need(isinstance(request, dict) and isinstance(request.get("requestId"), str) and
              _REQUEST.fullmatch(request["requestId"]), "CUSTOMER_UPDATE_REQUEST_ID_REQUIRED")
        return self._write("customer-update-submit", {"dossierId": self.dossier_id,
            "inputFile": str(selected), "inputSha256": digest(body), "inputBytes": len(body)},
            request_id=request["requestId"], resume=resume, cancel_event=cancel_event)

    def saved_request(self, request_id):
        saved = self.workspace.call_record(request_id)
        request = saved["request"]
        _need(request.get("action") in _CUSTOMER_WRITES and
              request.get("input", {}).get("dossierId") == self.dossier_id,
              "CUSTOMER_UPDATE_SAVED_SELECTION_CHANGED")
        return saved

    def recover(self, request_id, *, cancel_event=None):
        """Read or continue the existing saved operation using its original ID."""
        with self.workspace._operation(cancel_event) as event:
            saved = self.saved_request(request_id)["request"]
            value = saved["input"]
            descriptor = self.workspace._write_call(saved["action"], value,
                request_id=request_id, replay_safe=True, resume=True, event=event)
            result = self._decode(descriptor, saved["action"], value, saved["workspaceId"])
            return self._verify_completed(saved["action"], result)

    def replay(self, request_id, *, replay_id, resume=False, cancel_event=None):
        """Actually send the retained native request again after later work.

        Unlike recover(), this intentionally reaches the existing native writer.
        Its original request ID and revision are unchanged. replay_id identifies
        a separate durable Python attempt; recover(replay_id) reopens that exact
        attempt, while another explicit replay_id reaches the native writer again.
        """
        _need(_request_id(replay_id) != request_id, "CUSTOMER_UPDATE_REPLAY_ID_MUST_BE_DISTINCT")
        with self.workspace._operation(cancel_event) as event:
            saved = self.saved_request(request_id)["request"]
            _need(saved["action"] == "customer-update-submit", "CUSTOMER_UPDATE_SAVED_UPDATE_REQUIRED")
            original = saved["input"].get("input")
            if original is None:
                selected = saved["input"]
                candidates = [Path(selected["responseDirectory"]) / "source-request.json",
                              Path(selected["directory"]) / "input.json", Path(selected["inputFile"])]
                source = next((path for path in candidates if path.exists() or path.is_symlink()), candidates[0])
                raw = read(source, _LIMIT)
                _need(len(raw) == selected["inputBytes"] and digest(raw) == selected["inputSha256"],
                      "CUSTOMER_UPDATE_INPUT_FILE_CHANGED")
                original = parse(raw)
            normalized = self.validate(original, _owned_event=event)["request"]
            _need(normalized["requestId"] == request_id, "CUSTOMER_UPDATE_SAVED_SELECTION_CHANGED")
            return self._write("customer-update-replay", {"dossierId": self.dossier_id,
                "request": normalized}, request_id=replay_id, resume=resume, _owned_event=event)

    def _action(self, action, data, *, request_id, expected_revision, actor,
                resume=False, cancel_event=None):
        return self.submit({"requestId": request_id, "expectedRevision": expected_revision,
            "actor": _snapshot(actor), "action": action, "data": _snapshot(data)},
            resume=resume, cancel_event=cancel_event)

    def create_project(self, data, **request):
        return self._action("create-project", data, **request)

    def revise_brief(self, data, **request):
        return self._action("revise-brief", data, **request)

    def record_agreement(self, data, **request):
        return self._action("record-agreement", data, **request)

    def request_update(self, data, **request):
        return self._action("request-update", data, **request)

    def revise_request(self, data, **request):
        return self._action("revise-request", data, **request)

    def attach_intake(self, data, **request):
        return self._action("attach-intake", data, **request)

    def review_work(self, data, **request):
        return self._action("review-work", data, **request)

    def publish_delivery(self, data, **request):
        return self._action("publish-delivery", data, **request)

    def record_delivery(self, data, **request):
        return self._action("record-delivery", data, **request)

    def set_project_status(self, data, **request):
        return self._action("set-project-status", data, **request)

    def export(self, *, request_id, delivery_id=None, work_id=None, revision=None,
               format="json", directory=None, expected_sha256=None, resume=False,
               cancel_event=None):
        _need((delivery_id is None) != (work_id is None) and format in FORMATS and
              (work_id is None or format == "json"), "CUSTOMER_UPDATE_EXPORT_SELECTION_REQUIRED")
        _revision(revision)
        value = {"dossierId": self.dossier_id, "format": format}
        for key, item in (("deliveryId", delivery_id), ("workId", work_id),
                          ("revision", revision), ("expectedSha256", expected_sha256)):
            if item is not None:
                value[key] = item
        if directory is not None:
            value["directory"] = _absolute(directory)
        result = self._write("customer-update-export", value, request_id=request_id,
                             resume=resume, cancel_event=cancel_event)
        file = result["file"]
        return _file_delivery({**file, "file": file["path"], "customerOperation": result})

    def handover(self, *, request_id, delivery_id, directory, revision=None,
                 source_workspace=None, resume=False, cancel_event=None):
        _revision(revision)
        value = {"dossierId": self.dossier_id, "deliveryId": delivery_id,
                 "directory": _absolute(directory)}
        if revision is not None:
            value["revision"] = revision
        if source_workspace is not None:
            value["sourceWorkspace"] = _snapshot(source_workspace)
        result = self._write("customer-handover-create", value, request_id=request_id,
                             resume=resume, cancel_event=cancel_event)
        return ResearchCustomerDelivery(result)

    def inspect_handover(self, directory, *, manifest_sha256=None, cancel_event=None):
        value = {"directory": _absolute(directory)}
        if manifest_sha256 is not None:
            value["manifestSha256"] = _hash(manifest_sha256)
        return ResearchCustomerDelivery(self._read("customer-handover-inspect", value,
                                                   cancel_event=cancel_event))

    def receive_handover(self, source_directory, *, request_id, directory,
                         manifest_sha256, source_actor=None, resume=False, cancel_event=None):
        value = {"directory": _absolute(directory), "dossierId": self.dossier_id,
                 "sourceDirectory": _absolute(source_directory), "manifestSha256": _hash(manifest_sha256)}
        if source_actor is not None:
            value["sourceActor"] = source_actor
        result = self._write("customer-handover-receive", value, request_id=request_id,
                             resume=resume, cancel_event=cancel_event)
        _need(result.get("dossierId") == self.dossier_id, "CUSTOMER_UPDATE_RECEIVING_DOSSIER_CHANGED")
        return result

    def operation(self, directory, *, cancel_event=None):
        return self._read("customer-operation-inspect", {"directory": _absolute(directory)},
                          cancel_event=cancel_event)
