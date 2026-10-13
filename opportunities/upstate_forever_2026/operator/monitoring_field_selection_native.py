"""Source-bound field-selection receiving on the original operator queue."""
from copy import deepcopy

from model.common import verify_file, relative_file
from model import monitoring_field_selection as selections

ACTION = "monitoring.field-selection.receive"


def decorated(operator, workspace_key, record):
    public = deepcopy(record)
    workspace = operator.ws(workspace_key)
    public["workspace_key"] = workspace_key
    public["_downloads"] = [operator._ticket(workspace_key, verify_file(workspace.root, item),
                                            item, item["label"]) for item in record["files"]]
    return public


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    value = {key: item for key, item in payload.items() if key != "workspace"}
    if operation == "catalog":
        if value:
            raise ValueError("Field selection catalog takes no selection parameters")
        return {"workspace_key": workspace_key, **selections.catalog(workspace)}
    if operation == "source":
        if set(value) != {"source_collection_id", "source_id"}:
            raise ValueError("Choose one original field-study source")
        data, entry, binding = selections.source(workspace, **value)
        ticket = operator._ticket(workspace_key, relative_file(workspace.root, entry["body"]["object"]),
                                  entry["body"], "Original field-planning desk")
        return {"workspace_key": workspace_key, "source": binding, "title": entry["title"], "_downloads": [ticket]}
    if operation == "preview":
        return {"workspace_key": workspace_key, **selections.preview(workspace, **value)}
    if operation == "inspect":
        if set(value) != {"selection_id"}:
            raise ValueError("Choose one saved field selection")
        return decorated(operator, workspace_key, selections.inspect(workspace, value["selection_id"]))
    raise ValueError("Choose a registered field-selection read")


def perform(operator, task):
    if task["action"] != ACTION:
        raise ValueError("Choose the registered field-selection receive action")
    return selections.receive(operator.ws(task["workspace"]), **task["payload"])


def decorate_task(operator, task):
    if task.get("action") != ACTION or task.get("state") != "complete":
        return task
    public = deepcopy(task)
    record = selections.inspect(operator.ws(task["workspace"]), task["result"]["id"])
    public["_downloads"] = decorated(operator, task["workspace"], record)["_downloads"]
    return public


def verify_workspace(workspace):
    return selections.verify_workspace(workspace)
