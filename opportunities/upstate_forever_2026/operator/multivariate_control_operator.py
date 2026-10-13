"""Matched-control design on the original Operator queue and verified files."""
from __future__ import annotations
from copy import deepcopy
from model import multivariate_control as native
from model.common import atomic_json, identifier, now, read_json, verify_file

ACTIONS = frozenset({"control.prepare", "control.adopt", "control.execute"})

class MultivariateControlOperator:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault

    def _progress_path(self, ws, task_id):
        return ws.root / "multivariate-control-operations" / (identifier(task_id) + ".json")

    def _decorate(self, workspace, value):
        result = deepcopy(value)
        ws = self.operator.ws(workspace)
        result["_downloads"] = []
        for row in result.get("files", []):
            path = verify_file(ws.root, row)
            result["_downloads"].append(self.operator._ticket(workspace, path, row, path.name))
        return result

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return native.catalog(ws)
        if operation == "preview":
            return native.preview(ws, payload.get("selection"))
        if operation == "inspect":
            return self._decorate(workspace_key, native.inspect(ws, identifier(payload.get("design_id"))))
        if operation == "progress":
            task_id = identifier(payload.get("task_id"))
            task = self.operator.task(task_id)
            if task.get("workspace") != workspace_key or task.get("action") not in ACTIONS:
                raise self.fault("CONTROL_TASK", "Choose an original matched-control task in this project.", 404)
            path = self._progress_path(ws, task_id)
            return {"task_id": task_id, "state": task["state"],
                    "progress": read_json(path) if path.exists() else None,
                    "design_id": task.get("control_design_id"), "error": task.get("error")}
        raise self.fault("CONTROL_READ", "Choose a matched-control catalogue, preview, design or task.", 404)

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        payload = task["payload"]
        action = task["action"]
        if action not in ACTIONS:
            raise self.fault("CONTROL_ACTION", "Choose an original matched-control operation.")
        path = self._progress_path(ws, task["id"])
        def progress(value):
            atomic_json(path, {"schema": "upstate.multivariate-control-operation/v1",
                              "project_id": ws.project["id"], "task_id": task["id"],
                              "request_sha256": task["request_sha256"],
                              "design_id": task.get("control_design_id"),
                              "updated_at": now(), "progress": deepcopy(value)})
        if action == "control.prepare":
            selection = payload.get("selection")
            preview = native.preview(ws, selection)
            task["control_design_id"] = preview["id"]
            if payload.get("expected_design_id") != preview["id"]:
                raise ValueError("Original source bindings changed after review; preview this design again.")
            progress({"state": "preparing", "design_id": preview["id"]})
            result = native.prepare(ws, selection, progress=progress)
        else:
            key = identifier(payload.get("design_id"))
            task["control_design_id"] = key
            progress({"state": "adopting" if action == "control.adopt" else "executing", "design_id": key})
            if action == "control.adopt":
                result = native.adopt(ws, key)
            else:
                result = native.execute(ws, key)
                # Preserve the original execution result and an explicit source
                # design. Inspection remains on the native retained design.
                result = {"design_id": key, "execution": result}
        progress({"state": "complete", "design_id": task["control_design_id"]})
        return result

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        key = task.get("control_design_id")
        if key:
            task["_control_design_id"] = key
            try:
                result = self._decorate(task["workspace"],
                    native.inspect(self.operator.ws(task["workspace"]), key))
                task.setdefault("_downloads", []).extend(result["_downloads"])
                task["_control_state"] = result["state"]
                if result.get("adoption"):
                    task["_control_experiment_id"] = result["adoption"]["experiment_id"]
            except FileNotFoundError:
                pass
        return task
