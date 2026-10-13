"""Native field selection preview, task queue and original report downloads."""
from model import monitoring_field_assignment as assignments
from model.common import verify_file

ACTION = "monitoring.field-assignment.save"
ACTIONS = {ACTION}


def _public(operator, workspace_key, key):
    workspace = operator.ws(workspace_key)
    result = assignments.inspect(workspace, key)
    result["workspace_key"] = workspace_key
    result["_downloads"] = [
        operator._ticket(workspace_key, verify_file(workspace.root, row), row, name)
        for name, row in result["files"].items()
        if name == "field-selection.json" or name.startswith("report/")
    ]
    return result


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the saved monitoring field assignment action.")
    return assignments.build(operator.ws(workspace_key), payload)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return assignments.catalog(workspace)
    if operation == "preview":
        return assignments.preview(workspace, payload)
    if operation == "detail":
        return _public(operator, workspace_key, payload["id"])
    raise ValueError("Choose an original monitoring field assignment.")


def overview(operator, workspace_key):
    return assignments.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task.get("action") == ACTION and task.get("state") == "complete":
        result = _public(operator, task["workspace"], task["result"]["id"])
        task["_downloads"] = result["_downloads"]
        task["_item"] = {"kind": assignments.KIND, "id": result["id"]}
    return task
