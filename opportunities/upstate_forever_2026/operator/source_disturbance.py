"""Source-selected land-change commands on the original authenticated operator queue."""
from __future__ import annotations
from copy import deepcopy
import re
from model.common import digest, read_json
from model.verified_files import verified_operation
from model.source_disturbance import SourceDisturbanceStudies
from model.common import identifier, relative_file
from urllib.parse import quote

ACTIONS = frozenset({"source-disturbance.prepare", "source-disturbance.report"})
OPERATION_ACTIONS = ACTIONS | {"run.start"}
READS = frozenset({"catalog", "item", "preview", "operation", "result", "features"})


class SourceDisturbanceDesk:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _service(self, workspace_key):
        return SourceDisturbanceStudies(self.operator.ws(workspace_key))

    @verified_operation
    def read(self, workspace_key, operation, payload):
        if operation not in READS or not isinstance(payload, dict):
            raise self.Fault("SOURCE_DISTURBANCE_READ", "Choose an original source-selected study read.")
        service = self._service(workspace_key)
        try:
            if operation == "catalog":
                value = service.catalog()
            elif operation == "features":
                value = service.features({k: deepcopy(v) for k, v in payload.items() if k != "workspace"})
            elif operation == "item":
                value = self._item(workspace_key, identifier(payload.get("study_id") or payload.get("id")))
            elif operation == "result":
                value = service.result(identifier(payload.get("study_id") or payload.get("id")))
            elif operation == "preview":
                value = service.preview({k: deepcopy(v) for k, v in payload.items() if k != "workspace"})
            else:
                value = self._operation(workspace_key, payload, service)
            return {"workspace_key": workspace_key, **value}
        except FileNotFoundError as error:
            raise self.Fault("SOURCE_DISTURBANCE_MISSING", "The original source-selected study record is unavailable.", 404) from error
        except (ValueError, TypeError) as error:
            raise self.Fault(getattr(error, "code", "SOURCE_DISTURBANCE_INPUT"), str(error), 422) from error

    def _operation(self, workspace_key, payload, service):
        """Resolve the exact operator UUID/alias before reading its domain journal."""
        operation_id = payload.get("operation_id")
        request = payload.get("request")
        if (not isinstance(operation_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id)
                or not isinstance(request, dict)
                or request.get("operation_id") != operation_id
                or request.get("action") not in OPERATION_ACTIONS
                or not isinstance(request.get("payload"), dict)
                or not isinstance(request.get("workspace"), str)):
            raise self.Fault("SOURCE_DISTURBANCE_REQUEST", "Read the complete exact original queued request.")
        native_request = {name: deepcopy(request[name]) for name in ("workspace", "action", "payload")}
        request_sha = digest(native_request)
        original_key = digest({"workspace": request["workspace"], "operation_id": operation_id})
        explicit_key = payload.get("task_id")
        if explicit_key is not None and (not isinstance(explicit_key, str)
                                        or not re.fullmatch(r"[0-9a-f]{64}", explicit_key)):
            raise self.Fault("SOURCE_DISTURBANCE_TASK", "Choose the actual original task identity.")
        task = None
        key = original_key
        with self.operator.lock:
            alias_path = self.operator.root / "task-operation-aliases" / (original_key + ".json")
            task_path = self.operator.root / "tasks" / (original_key + ".json")
            if alias_path.exists():
                alias = read_json(alias_path)
                if (alias.get("schema") != "upstate.operator-operation-alias/v1"
                        or alias.get("workspace") != request["workspace"]
                        or alias.get("operation_id") != operation_id
                        or alias.get("request_sha256") != request_sha
                        or task_path.exists()
                        or not isinstance(alias.get("task_id"), str)
                        or not re.fullmatch(r"[0-9a-f]{64}", alias["task_id"])):
                    raise self.Fault("SOURCE_DISTURBANCE_ALIAS", "The retained original task alias differs from this request.", 409)
                key = alias["task_id"]
                task = self.operator.task(key)
            elif task_path.exists():
                task = self.operator.task(key)
            elif explicit_key is not None:
                key = explicit_key
                candidate = self.operator.root / "tasks" / (key + ".json")
                if candidate.exists():
                    task = self.operator.task(key)
            if explicit_key is not None and explicit_key != key:
                raise self.Fault("SOURCE_DISTURBANCE_TASK", "The requested task differs from the retained original alias.", 409)
            if task is not None:
                if (task.get("id") != key or task.get("request_sha256") != request_sha
                        or digest({name: task.get(name) for name in ("workspace", "action", "payload")}) != request_sha):
                    raise self.Fault("SOURCE_DISTURBANCE_REQUEST_CHANGED", "The original task belongs to different inputs.", 409)
                self.operator.team.check_workspace(task["workspace"])
                original_ws = self.operator.ws(task["workspace"])
                if original_ws.project["id"] != self.operator.ws(workspace_key).project["id"]:
                    raise self.Fault("SOURCE_DISTURBANCE_PROJECT", "The task belongs to another scientific project.", 409)
                task = deepcopy(task)
        # A queued task need not have entered the source-selected study model yet.
        journal = {"status": "NOT_FOUND"} if request["action"] == "run.start" else service.operation(key)
        if journal.get("status") != "NOT_FOUND":
            origin = journal.get("context") or journal.get("origin")
            if not isinstance(origin, dict):
                raise self.Fault("SOURCE_DISTURBANCE_ORIGIN", "This command has no retained operator origin; inspect its native CLI operation separately.", 409)
            if (origin.get("task_id") != key
                    or origin.get("workspace") != request["workspace"]
                    or origin.get("action") != request["action"]
                    or origin.get("payload") != request["payload"]
                    or origin.get("request_sha256") != request_sha):
                raise self.Fault("SOURCE_DISTURBANCE_ORIGIN_CHANGED", "The retained project operation differs from these original inputs.", 409)
            if origin.get("operation_id") != operation_id:
                # A local alias is the only authority for an alternate user UUID.
                if task is None or not alias_path.exists():
                    raise self.Fault("SOURCE_DISTURBANCE_ALIAS_REQUIRED", "Receive the original operator task and alias history before continuing this aliased request.", 409)
            if journal.get("project_id") != self.operator.ws(workspace_key).project["id"]:
                raise self.Fault("SOURCE_DISTURBANCE_PROJECT", "The operation belongs to another scientific project.", 409)
        if task is not None:
            result = {**journal, "task": task, "task_id": key}
            if journal.get("status") == "NOT_FOUND":
                result["status"] = "PENDING" if task["state"] in {"queued", "running", "interrupted"} else task["state"].upper()
                result["result"] = task.get("result")
                result["error"] = task.get("error")
            return result
        return {**journal, "task": None, "task_id": key if journal.get("status") != "NOT_FOUND" else explicit_key,
                "requires_operator_handoff": journal.get("status") == "NOT_FOUND" and request["workspace"] != workspace_key}

    @verified_operation
    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("SOURCE_DISTURBANCE_ACTION", "Choose a supported source-selected study operation.")
        service = self._service(task["workspace"])
        context = {name: deepcopy(task.get(name)) for name in
                   ("operation_id", "workspace", "action", "payload", "request_sha256", "requested_by")}
        context["task_id"] = task["id"]
        if task["action"] == "source-disturbance.prepare":
            return service.prepare(deepcopy(task["payload"]), operation_id=task["id"], context=context)
        study_id = identifier(task["payload"].get("study_id"))
        return service.report(study_id, operation_id=task["id"], context=context)

    def state(self, workspace_key):
        # Global polling reads saved study metadata only; full catalog is explicit.
        return self._service(workspace_key).summaries()

    def _report(self, workspace_key, study_id):
        self.operator.team.check_workspace(workspace_key)
        workspace = self.operator.ws(workspace_key)
        study = self._service(workspace_key).inspect(identifier(study_id))
        report = study.get("report")
        if not isinstance(report, dict):
            raise self.Fault("SOURCE_DISTURBANCE_REPORT_MISSING", "Create the original completed report first.", 404)
        return workspace, report

    def _item(self, workspace_key, study_id):
        workspace = self.operator.ws(workspace_key)
        study = self._service(workspace_key).inspect(study_id)
        directory = workspace.root / "source-disturbance-studies" / study_id
        downloads = self.operator._files(workspace_key, study, directory)
        if study.get("report") is not None:
            _, report = self._report(workspace_key, study_id)
            study["report"] = report
            for name, descriptor in report["files"].items():
                ticket = self.operator._ticket(workspace_key,
                    relative_file(directory / "report", descriptor["path"]), descriptor,
                    descriptor.get("title") or name.replace("_", " "))
                downloads.append({**ticket, "role": name, "media_type": descriptor.get("media_type")})
            html = report["files"].get("report.html")
            if html:
                study["_report_preview_url"] = ("/api/file/source-disturbance/"
                    + quote(workspace_key, safe="") + "/" + study_id + "/"
                    + quote(html["path"], safe="/"))
        study["_downloads"] = downloads
        return study

    @verified_operation
    def report_member(self, workspace_key, study_id, member):
        """Original authenticated file transport, scoped to the complete report inventory."""
        study_id = identifier(study_id)
        workspace, report = self._report(workspace_key, study_id)
        selected = [descriptor for descriptor in report["files"].values()
                    if descriptor["path"] == member]
        if len(selected) != 1:
            raise self.Fault("SOURCE_DISTURBANCE_REPORT_MEMBER", "Choose an original retained report member.", 404)
        descriptor = selected[0]
        path = relative_file(workspace.root / "source-disturbance-studies" / study_id / "report", member)
        ticket = self.operator._ticket(workspace_key, path, descriptor,
                                       descriptor.get("title") or path.name)
        policy = ("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; "
                  "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; "
                  "frame-ancestors 'self'; sandbox allow-same-origin allow-popups "
                  "allow-popups-to-escape-sandbox allow-downloads")
        return ticket, policy
