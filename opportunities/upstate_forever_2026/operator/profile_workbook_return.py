"""Exact saved-profile workbook return on the existing authenticated Profile workbench."""
from __future__ import annotations
from copy import deepcopy
import re
from model import profile_workbook_return as model
from model.common import describe_file, digest, identifier, read_json, verify_file
from model.verified_files import verified_operation

ACTIONS = frozenset({"profile.workbook_return.create"})
READS = frozenset({"workbook-return-" + name for name in
                  ("catalog", "profile", "book", "preview", "inspect", "operation")})


class ProfileWorkbookReturn:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _downloads(self, workspace_key, result):
        ws = self.operator.ws(workspace_key)
        downloads = []
        for role, descriptor in result["files"].items():
            path = verify_file(ws.root, descriptor)
            ticket = self.operator._ticket(workspace_key, path, descriptor, role.replace("_", " "))
            downloads.append({**ticket, "role": role, "media_type": descriptor.get("media_type")})
        receipt_path = ws.root / model.ROOT / result["id"] / "result.json"
        downloads.append({**self.operator._ticket(workspace_key, receipt_path,
                         describe_file(ws.root, receipt_path), "Original return receipt"),
                         "role": "receipt", "media_type": "application/json"})
        return downloads

    def _inspect(self, workspace_key, return_id):
        result = model.inspect(self.operator.ws(workspace_key), identifier(return_id))
        result["_downloads"] = self._downloads(workspace_key, result)
        return result

    @verified_operation
    def read(self, workspace_key, operation, payload=None):
        if operation not in READS or not isinstance(payload, dict):
            raise self.Fault("PROFILE_WORKBOOK_RETURN_READ", "Choose an original workbook return view.")
        value = {key: deepcopy(item) for key, item in payload.items() if key != "workspace"}
        ws = self.operator.ws(workspace_key)
        try:
            if operation == "workbook-return-catalog":
                result = model.catalog(ws)
            elif operation == "workbook-return-profile":
                result = model.profile(ws, value.get("profile_id"))
            elif operation == "workbook-return-book":
                result = model.book(ws, value)
            elif operation == "workbook-return-preview":
                result = model.preview(ws, value)
            elif operation == "workbook-return-inspect":
                result = self._inspect(workspace_key, value.get("id"))
            else:
                result = self._operation(workspace_key, value)
            return {"workspace_key": workspace_key, **result}
        except FileNotFoundError as error:
            raise self.Fault("PROFILE_WORKBOOK_RETURN_MISSING", "The retained original workbook return source is unavailable.", 404) from error
        except (ValueError, TypeError) as error:
            raise self.Fault("PROFILE_WORKBOOK_RETURN_INPUT", str(error), 422) from error

    def _operation(self, workspace_key, payload):
        """Resolve the exact operator UUID/alias before reading its domain journal."""
        operation_id = payload.get("operation_id")
        request = payload.get("request")
        if (not isinstance(operation_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id)
                or not isinstance(request, dict)
                or request.get("operation_id") != operation_id
                or request.get("action") not in ACTIONS
                or not isinstance(request.get("payload"), dict)
                or not isinstance(request.get("workspace"), str)):
            raise self.Fault("PROFILE_WORKBOOK_RETURN_REQUEST", "Read the complete exact original queued request.")
        native_request = {name: deepcopy(request[name]) for name in ("workspace", "action", "payload")}
        request_sha = digest(native_request)
        original_key = digest({"workspace": request["workspace"], "operation_id": operation_id})
        explicit_key = payload.get("task_id")
        if explicit_key is not None and (not isinstance(explicit_key, str)
                                        or not re.fullmatch(r"[0-9a-f]{64}", explicit_key)):
            raise self.Fault("PROFILE_WORKBOOK_RETURN_TASK", "Choose the actual original task identity.")
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
                    raise self.Fault("PROFILE_WORKBOOK_RETURN_ALIAS", "The retained original task alias differs from this request.", 409)
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
                raise self.Fault("PROFILE_WORKBOOK_RETURN_TASK", "The requested task differs from the retained original alias.", 409)
            if task is not None:
                if (task.get("id") != key or task.get("request_sha256") != request_sha
                        or digest({name: task.get(name) for name in ("workspace", "action", "payload")}) != request_sha):
                    raise self.Fault("PROFILE_WORKBOOK_RETURN_REQUEST_CHANGED", "The original task belongs to different inputs.", 409)
                self.operator.team.check_workspace(task["workspace"])
                original_ws = self.operator.ws(task["workspace"])
                if original_ws.project["id"] != self.operator.ws(workspace_key).project["id"]:
                    raise self.Fault("PROFILE_WORKBOOK_RETURN_PROJECT", "The task belongs to another scientific project.", 409)
                task = deepcopy(task)
        # A queued task need not have entered the source-selected study model yet.
        journal = model.operation(self.operator.ws(workspace_key), key)
        journal["status"] = journal["state"]
        if journal.get("status") != "NOT_FOUND":
            origin = journal.get("context") or journal.get("origin")
            if not isinstance(origin, dict):
                raise self.Fault("PROFILE_WORKBOOK_RETURN_ORIGIN", "This command has no retained operator origin; inspect its native CLI operation separately.", 409)
            if (origin.get("task_id") != key
                    or origin.get("workspace") != request["workspace"]
                    or origin.get("action") != request["action"]
                    or digest(origin.get("payload")) != digest(request["payload"])
                    or origin.get("request_sha256") != request_sha):
                raise self.Fault("PROFILE_WORKBOOK_RETURN_ORIGIN_CHANGED", "The retained project operation differs from these original inputs.", 409)
            if origin.get("operation_id") != operation_id:
                # A local alias is the only authority for an alternate user UUID.
                if task is None or not alias_path.exists():
                    raise self.Fault("PROFILE_WORKBOOK_RETURN_ALIAS_REQUIRED", "Receive the original operator task and alias history before continuing this aliased request.", 409)
            if journal.get("project_id") != self.operator.ws(workspace_key).project["id"]:
                raise self.Fault("PROFILE_WORKBOOK_RETURN_PROJECT", "The operation belongs to another scientific project.", 409)
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
            raise self.Fault("PROFILE_WORKBOOK_RETURN_ACTION", "Choose the original workbook return action.")
        context = {name: deepcopy(task.get(name)) for name in
                   ("operation_id", "workspace", "action", "payload", "request_sha256", "requested_by")}
        context["task_id"] = task["id"]
        return model.create(self.operator.ws(task["workspace"]), deepcopy(task["payload"]),
                            operation_id=task["id"], context=context)

    @verified_operation
    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        value = deepcopy(task)
        result = self._inspect(value["workspace"], value["result"]["id"])
        value["_downloads"] = result["_downloads"]
        return value

    def verify_all(self, workspace):
        return model.verify_all(workspace)
