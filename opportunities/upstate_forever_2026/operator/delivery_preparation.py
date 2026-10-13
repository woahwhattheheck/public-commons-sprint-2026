"""Saved delivery preparations on the maintained operator's authenticated queue."""
from __future__ import annotations
from copy import deepcopy
import re
from model.common import digest, read_json
from model.delivery_preparation import DeliveryPreparations

ACTIONS = frozenset({"delivery.preparation.save", "delivery.preparation.build"})
READS = frozenset({"catalog", "item", "preview", "operation"})


class DeliveryPreparationDesk:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _service(self, workspace_key):
        return DeliveryPreparations(self.operator.ws(workspace_key))

    def read(self, workspace_key, operation, payload):
        if operation not in READS or not isinstance(payload, dict):
            raise self.Fault("PREPARATION_READ", "Choose an original preparation read.")
        service = self._service(workspace_key)
        try:
            if operation == "catalog":
                value = service.catalog(offset=payload.get("offset", 0), limit=payload.get("limit", 50))
            elif operation == "item":
                value = service.inspect(payload.get("preparation_id") or payload.get("id"),
                                        revision=payload.get("revision"))
            elif operation == "preview":
                value = service.preview({k: deepcopy(v) for k, v in payload.items() if k != "workspace"})
            else:
                value = self._operation(workspace_key, payload, service)
            return {"workspace_key": workspace_key, **value}
        except FileNotFoundError as error:
            raise self.Fault("PREPARATION_MISSING", "The original preparation record is unavailable.", 404) from error
        except (ValueError, TypeError) as error:
            raise self.Fault("PREPARATION_INPUT", str(error), 422) from error

    def _operation(self, workspace_key, payload, service):
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
            raise self.Fault("PREPARATION_REQUEST", "Read the complete exact original queued request.")
        native_request = {name: deepcopy(request[name]) for name in ("workspace", "action", "payload")}
        request_sha = digest(native_request)
        original_key = digest({"workspace": request["workspace"], "operation_id": operation_id})
        explicit_key = payload.get("task_id")
        if explicit_key is not None and (not isinstance(explicit_key, str)
                                        or not re.fullmatch(r"[0-9a-f]{64}", explicit_key)):
            raise self.Fault("PREPARATION_TASK", "Choose the actual original task identity.")
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
                    raise self.Fault("PREPARATION_ALIAS", "The retained original task alias differs from this request.", 409)
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
                raise self.Fault("PREPARATION_TASK", "The requested task differs from the retained original alias.", 409)
            if task is not None:
                if (task.get("id") != key or task.get("request_sha256") != request_sha
                        or digest({name: task.get(name) for name in ("workspace", "action", "payload")}) != request_sha):
                    raise self.Fault("PREPARATION_REQUEST_CHANGED", "The original task belongs to different inputs.", 409)
                self.operator.team.check_workspace(task["workspace"])
                original_ws = self.operator.ws(task["workspace"])
                if original_ws.project["id"] != self.operator.ws(workspace_key).project["id"]:
                    raise self.Fault("PREPARATION_PROJECT", "The task belongs to another scientific project.", 409)
                task = deepcopy(task)
        # A queued task need not have entered the preparation model yet.
        journal = service.operation(key)
        if journal.get("status") != "NOT_FOUND":
            origin = journal.get("context") or journal.get("origin")
            if not isinstance(origin, dict):
                raise self.Fault("PREPARATION_ORIGIN", "This command has no retained operator origin; inspect its native CLI operation separately.", 409)
            if (origin.get("task_id") != key
                    or origin.get("workspace") != request["workspace"]
                    or origin.get("action") != request["action"]
                    or origin.get("payload") != request["payload"]
                    or origin.get("request_sha256") != request_sha):
                raise self.Fault("PREPARATION_ORIGIN_CHANGED", "The retained project operation differs from these original inputs.", 409)
            if origin.get("operation_id") != operation_id:
                # A local alias is the only authority for an alternate user UUID.
                if task is None or not alias_path.exists():
                    raise self.Fault("PREPARATION_ALIAS_REQUIRED", "Receive the original operator task and alias history before continuing this aliased request.", 409)
            if journal.get("project_id") != self.operator.ws(workspace_key).project["id"]:
                raise self.Fault("PREPARATION_PROJECT", "The operation belongs to another scientific project.", 409)
        if task is not None:
            result = {**journal, "task": task, "task_id": key}
            if journal.get("status") == "NOT_FOUND":
                result["status"] = "PENDING" if task["state"] in {"queued", "running", "interrupted"} else task["state"].upper()
                result["result"] = task.get("result")
                result["error"] = task.get("error")
            return result
        return {**journal, "task": None, "task_id": key if journal.get("status") != "NOT_FOUND" else explicit_key,
                "requires_operator_handoff": journal.get("status") == "NOT_FOUND" and request["workspace"] != workspace_key}

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("PREPARATION_ACTION", "Choose a supported preparation operation.")
        service = self._service(task["workspace"])
        context = {name: deepcopy(task.get(name)) for name in
                   ("operation_id", "workspace", "action", "payload", "request_sha256", "requested_by")}
        context["task_id"] = task["id"]
        method = service.save if task["action"] == "delivery.preparation.save" else service.build
        return method(deepcopy(task["payload"]), operation_id=task["id"],
                      created_at=task["created_at"], context=context)

    def state(self, workspace_key):
        value = self._service(workspace_key).catalog(offset=0, limit=50)
        return {"schema": value["schema"], "project_id": value["project_id"],
                "items": value["items"], "total": value["total"],
                "next_offset": value.get("next_offset")}

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        row = deepcopy(task)
        result = row.get("result")
        if isinstance(result, dict):
            delivery_id = result.get("delivery_id")
            if delivery_id:
                row["_delivery_preparation"] = {"delivery_id": delivery_id}
        return row
