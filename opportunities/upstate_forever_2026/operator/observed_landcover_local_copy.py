"""Queued original-source admission and native local-copy downloads."""
from model import observed_landcover_local_copy as copies
from model.common import identifier, verify_file

ACTION = "received.landcover.copy"


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the received land-cover local-copy action")
    return copies.create(operator.ws(workspace_key), payload)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "preview":
        return copies.preview(workspace, {name: value for name, value in payload.items() if name != "workspace"})
    if operation == "copies":
        source = {"source_collection_id": identifier(payload.get("source_collection_id")),
                  "source_id": payload.get("source_id")}
        return {"items": copies.list_copies(workspace, study_id=identifier(payload.get("study_id")),
                                           source=source)}
    if operation == "copy":
        value = copies.get(workspace, payload["id"])
        value["_downloads"] = _downloads(operator, workspace_key, value)
        return value
    raise ValueError("Choose an existing received land-cover admission")


def _downloads(operator, workspace_key, value):
    workspace = operator.ws(workspace_key)
    return [operator._ticket(workspace_key, verify_file(workspace.root, row),
                             {**row, "filename": name + ".json"}, name)
            for name, row in value["files"].items()]


def decorate_task(operator, task):
    if task["action"] == ACTION and task["state"] == "complete":
        value = copies.get(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], value)
        task["_item"] = {"kind": "observed-landcover-selections", "id": value["local_selection_id"]}
    return task
