"""Native captured-review admission through the existing operator task queue."""
from model import published_review_admission as admissions
from model.common import identifier, verify_file

ACTION = "received.published-review.admit"


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the original captured-review admission")
    return admissions.create(operator.ws(workspace_key), payload)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "preview":
        return admissions.preview(workspace, {key: value for key, value in payload.items() if key != "workspace"})
    if operation == "admission":
        value = admissions.get(workspace, identifier(payload.get("id")))
        value["_downloads"] = _downloads(operator, workspace_key, value)
        return value
    raise ValueError("Choose an original review admission")


def _downloads(operator, workspace_key, value):
    workspace = operator.ws(workspace_key)
    return [operator._ticket(workspace_key, verify_file(workspace.root, item),
                             {**item, "filename": "original-review.zip" if name == "original_review_archive" else name + ".json"}, name)
            for name, item in value["files"].items()]


def decorate_task(operator, task):
    if task["action"] == ACTION and task["state"] == "complete":
        value = admissions.get(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], value)
    return task
