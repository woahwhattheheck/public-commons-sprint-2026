"""Original queue and verified downloads for native matched-control outcomes."""
from __future__ import annotations
from copy import deepcopy
from model import multivariate_control_outcomes as native
from model.common import atomic_json, identifier, now, read_json, verify_file

ACTION = "control.outcomes.prepare"

class MultivariateControlOutcomesOperator:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault

    def _progress_path(self, ws, task_id):
        return ws.root / "multivariate-control-outcome-operations" / (identifier(task_id) + ".json")

    def _decorate(self, workspace, value):
        result = deepcopy(value)
        ws = self.operator.ws(workspace)
        result["_downloads"] = []
        for row in result.get("files", []):
            path = verify_file(ws.root, row)
            ticket = self.operator._ticket(workspace, path, row, path.name)
            ticket["source_path"] = row["path"]
            result["_downloads"].append(ticket)
        return result

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return native.catalog(ws)
        if operation == "preview":
            return native.preview(ws, payload.get("selection"))
        if operation == "inspect":
            return self._decorate(workspace_key, native.inspect(ws, identifier(payload.get("outcome_id"))))
        if operation == "progress":
            task_id = identifier(payload.get("task_id"))
            task = self.operator.task(task_id)
            if task.get("workspace") != workspace_key or task.get("action") != ACTION:
                raise self.fault("CONTROL_OUTCOME_TASK", "Choose an original outcome task in this project.", 404)
            path = self._progress_path(ws, task_id)
            return {"task_id": task_id, "state": task["state"],
                    "progress": read_json(path) if path.exists() else None,
                    "outcome_id": task.get("control_outcome_id"), "error": task.get("error")}
        raise self.fault("CONTROL_OUTCOME_READ", "Choose a retained outcome catalogue, preview, result or task.", 404)

    def invoke(self, task):
        if task["action"] != ACTION:
            raise self.fault("CONTROL_OUTCOME_ACTION", "Choose an original native outcome analysis.")
        ws = self.operator.ws(task["workspace"])
        selection = task["payload"].get("selection")
        preview = native.preview(ws, selection)
        task["control_outcome_id"] = preview["id"]
        if task["payload"].get("expected_id") != preview["id"]:
            raise ValueError("Original native bindings changed after review; preview this comparison again.")
        path = self._progress_path(ws, task["id"])
        def progress(value):
            atomic_json(path, {"schema": "upstate.multivariate-control-outcome-operation/v1",
                              "project_id": ws.project["id"], "task_id": task["id"],
                              "request_sha256": task["request_sha256"],
                              "outcome_id": preview["id"], "updated_at": now(),
                              "progress": deepcopy(value)})
        progress({"state": "preparing", "outcome_id": preview["id"]})
        result = native.prepare(ws, selection, progress=progress)
        progress({"state": "complete", "outcome_id": result["id"]})
        return result

    def decorate_task(self, task):
        if task.get("action") != ACTION:
            return task
        key = task.get("control_outcome_id")
        if key:
            task["_control_outcome_id"] = key
            try:
                value = self._decorate(task["workspace"], native.inspect(self.operator.ws(task["workspace"]), key))
                task.setdefault("_downloads", []).extend(value["_downloads"])
                task["_control_outcome_state"] = value["state"]
            except FileNotFoundError:
                pass
        return task
