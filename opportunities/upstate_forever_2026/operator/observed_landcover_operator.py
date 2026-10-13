"""Original queue, catalogue and download integration for observed HUC changes."""
from model import observed_landcover

ACTIONS = {"observed.landcover.import", "observed.landcover.save"}


def _downloads(operator, workspace_key, edition):
    workspace = operator.ws(workspace_key)
    from model.common import verify_file
    return [operator._ticket(workspace_key, verify_file(workspace.root, row), row, name)
            for name, row in edition["files"].items() if not name.startswith("originals/")]


def invoke(operator, workspace_key, action, payload):
    workspace = operator.ws(workspace_key)
    if action == "observed.landcover.import":
        if payload:
            raise ValueError("Import the installed original completed land-cover source manifest")
        return observed_landcover.import_published(workspace)
    if action == "observed.landcover.save":
        return observed_landcover.build(workspace, payload)
    raise ValueError("Select an original observed land-cover action")


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return observed_landcover.catalog(workspace)
    if operation == "inputs":
        return observed_landcover.preview(workspace, payload["selection"])
    if operation == "edition":
        result = observed_landcover.inspect(workspace, payload["id"])
        result["_downloads"] = _downloads(operator, workspace_key, result["edition"])
        return result
    raise ValueError("Select an original observed land-cover reader")


def overview(operator, workspace_key):
    return observed_landcover.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task["action"] == "observed.landcover.save" and task["state"] == "complete":
        value = observed_landcover.inspect(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], value["edition"])
        task["_item"] = {"kind": observed_landcover.KIND, "id": value["edition"]["id"]}
    return task
