"""Original field crew packets on the maintained Implementation task queue."""
from __future__ import annotations
from copy import deepcopy
from model import field_deployment as deployment
from model.common import verify_file
from model.implementation import ImplementationStore
from model.implementation_schema import ImplementationError, _safe_id, _integer

ACTION = "implementation.field-deployment.prepare"


class FieldDeployment:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _request(self, workspace, value, *, preview=False):
        if not isinstance(value, dict) or value.get("workspace_key") not in (None, workspace):
            raise ImplementationError("Choose the saved field plan in its original Workspace")
        if any(name in value for name in ("path", "directory", "document", "upload_id")):
            raise ImplementationError("Choose the saved revision and its original visit IDs")
        plan_id = _safe_id(value.get("plan_id"), "plan_id")
        revision = value.get("revision")
        if not _integer(revision, 1):
            raise ImplementationError("Choose the original saved revision")
        ws = self.operator.ws(workspace)
        if preview:
            result = deployment.preview(ws, plan_id, revision, value.get("selection"))
        else:
            result = deployment.prepare(ws, plan_id, revision, value.get("selection"),
                                        expected_id=value.get("expected_id"))
            result = self._public(workspace, plan_id, result["id"])
        return dict(result, workspace_key=workspace)

    def _public(self, workspace, plan_id, key):
        ws = self.operator.ws(workspace)
        result = deployment.inspect(ws, plan_id, key)
        directory = deployment._root(ws, plan_id, key)
        downloads = [self.operator._ticket(workspace, verify_file(directory, row), row, name)
                     for name, row in result["files"].items()]
        return dict(result, workspace_key=workspace, _downloads=downloads)

    def read(self, workspace, operation, payload):
        value = payload or {}
        if operation == "preview":
            return self._request(workspace, value, preview=True)
        plan_id = _safe_id(value.get("plan_id"), "plan_id")
        if operation == "list":
            return {"workspace_key": workspace, "plan_id": plan_id,
                    "deployments": deployment.catalog(self.operator.ws(workspace), plan_id)}
        if operation == "detail":
            return self._public(workspace, plan_id, value.get("deployment_id"))
        raise self.Fault("FIELD_DEPLOYMENT_READ", "Choose a field deployment operation", 404)

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("FIELD_DEPLOYMENT_ACTION", "Choose the field crew packet action")
        return self._request(task["workspace"], task["payload"])

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        value = deepcopy(task)
        result = task["result"]
        value["result"] = self._public(task["workspace"], result["plan"]["plan_id"], result["id"])
        value["_downloads"] = value["result"]["_downloads"]
        return value

    def verify_workspace(self, workspace):
        store = ImplementationStore(workspace)
        records = []
        for path in sorted(store.base.glob("*/deployments/*/deployment.json")):
            row = deployment.inspect(workspace, path.parent.parent.parent.name, path.parent.name)
            records.append({"id": row["id"], "plan": row["plan"], "summary": row["summary"]})
        return {"field_deployments": records}
