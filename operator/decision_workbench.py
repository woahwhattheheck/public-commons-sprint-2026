"""HTTP/task adapter for the original operator's saved scenario assessments."""
from model import decisions
from model.common import file_digest

ACTIONS = {"decision.view.save"}
READS = {"catalog", "view", "assessment.upload"}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "assessment.upload":
        from model import decision_transfer
        return decision_transfer.upload(workspace, payload)
    if operation == "catalog":
        result = decisions.catalog(workspace)
        result["workspace_key"] = workspace_key
        result["saved_views"] = decisions.list_views(workspace)
        return result
    if operation == "view":
        result = decisions.inspect(workspace, payload["view_id"])
        result["workspace_key"] = workspace_key
        return result
    raise ValueError("Choose an existing scenario assessment operation.")


def invoke(operator, workspace_key, action, payload):
    if action != "decision.view.save":
        raise ValueError("Choose a supported scenario assessment action.")
    return decisions.save(operator.ws(workspace_key), payload)


def overview(operator, workspace_key):
    return decisions.list_views(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task["action"] == "decision.view.save" and task["state"] == "complete":
        workspace = operator.ws(task["workspace"])
        path = workspace.root / decisions.KIND / (task["result"]["id"] + ".json")
        body = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
        task["_downloads"] = [operator._ticket(
            task["workspace"], path, body, "Saved scenario assessment and original operands")]
    return task
