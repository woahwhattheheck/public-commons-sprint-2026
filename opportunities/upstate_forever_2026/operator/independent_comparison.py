"""Independent comparisons use the original authenticated task queue and verified files."""
from model import independent_comparison as comparison
from pathlib import Path
from model.common import verify_file, read_json

ACTION = "independent.comparison.save"

def _downloads(operator, workspace_key, edition):
    workspace = operator.ws(workspace_key)
    files = edition.get("files", {})
    return [operator._ticket(workspace_key, verify_file(workspace.root, row), row, name)
            for name, row in files.items()]

def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the retained independent comparison action")
    return comparison.build(operator.ws(workspace_key), payload)

def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        result = comparison.catalog(workspace)
    elif operation == "reference-context":
        result = read_json(Path(__file__).resolve().parents[1] / "source" / "usgs-southeast-sparrow-2012" / "fit-context" / "sparrow-fit-context.json")
    elif operation == "prediction-context":
        result = read_json(Path(__file__).resolve().parents[1] / "source" / "usgs-sparrow-upper-savannah-20261013" / "publisher-context" / "prediction-context.json")
    elif operation == "inputs":
        result = comparison.inputs(workspace, payload["selection"])
    elif operation == "preview":
        result = comparison.preview(workspace, payload["selection"])
    elif operation == "edition":
        result = comparison.inspect(workspace, payload["id"])
        result = {**result, "_downloads": _downloads(operator, workspace_key, result["edition"])}
    else:
        raise ValueError("Choose an original independent comparison reader")
    return {**result, "workspace_key": workspace_key, "project_id": workspace.project["id"]}

def overview(operator, workspace_key):
    return comparison.overview(operator.ws(workspace_key))

def decorate_task(operator, task):
    if task["action"] == ACTION and task["state"] == "complete":
        result = comparison.inspect(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], result["edition"])
        task["_item"] = {"kind": "independent-comparisons", "id": result["edition"]["id"]}
    return task
