"""Original task queue and downloads for retained cohort comparisons."""
from model import observation_comparability_store as comparisons

ACTIONS = {"observation.comparability.save"}


def _downloads(operator, workspace_key, edition):
    workspace = operator.ws(workspace_key)
    from model.common import verify_file
    visible = {"source/figures/activity-contributions.json", "source/figures/activity-contributions.csv",
               "source/figures/index.html", "source/figures/paired-period-data.json",
               "source/figures/paired-period-data.csv", "source/figures/paired-period-figures.json",
               "comparable-period-source.zip", "source/index.html", "source/comparability.json",
               "source/comparisons.csv", "source/monthly-support.csv", "source/activity-measurements.csv",
               "source/model-sources.json", "source/OBSERVATION_COMPARABILITY.md"}
    return [operator._ticket(workspace_key, verify_file(workspace.root, row), row, name)
            for name, row in edition["files"].items() if name in visible or
            (name.startswith("source/figures/paired-interval-") and name.endswith(".svg"))]


def _figures(operator, workspace_key, edition):
    from model.common import read_json, verify_file
    workspace = operator.ws(workspace_key)
    spec = edition["files"].get("source/figures/paired-period-figures.json")
    if spec is None:
        return []
    value = read_json(verify_file(workspace.root, spec))
    if value.get("schema") != "upstate.scientific-figure-spec/v1":
        raise ValueError("Retain the original paired-period figure specification")
    output = []
    for figure in value["figures"]:
        name = "source/figures/" + figure["id"] + ".svg"
        row = edition["files"][name]
        ticket = operator._ticket(workspace_key, verify_file(workspace.root, row), row, figure["title"])
        output.append({**ticket, "title": figure["title"], "caption": figure["caption"],
                       "series_id": figure["series_id"], "selection": figure["selection"]})
    return output


def _contributions(workspace, edition):
    from model.common import read_json, verify_file
    row = edition["files"].get("source/figures/activity-contributions.json")
    if row is None:
        return None
    value = read_json(verify_file(workspace.root, row))
    if value.get("schema") != "upstate.cohort-activity-contributions/v1":
        raise ValueError("Retain the original complete activity contribution ledger")
    return value


def invoke(operator, workspace_key, action, payload):
    if action != "observation.comparability.save":
        raise ValueError("Choose an original comparable-period operation")
    return comparisons.build(operator.ws(workspace_key), payload)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return comparisons.catalog(workspace)
    if operation == "inputs":
        return comparisons.inputs(workspace, payload["source"])
    if operation == "edition":
        result = comparisons.inspect(workspace, payload["id"])
        result["_downloads"] = _downloads(operator, workspace_key, result["edition"])
        result["_figures"] = _figures(operator, workspace_key, result["edition"])
        result["_contributions"] = _contributions(workspace, result["edition"])
        return result
    raise ValueError("Choose an original comparable-period reader")


def overview(operator, workspace_key):
    return comparisons.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task["action"] == "observation.comparability.save" and task["state"] == "complete":
        result = comparisons.inspect(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], result["edition"])
        task["_item"] = {"kind": comparisons.KIND, "id": result["edition"]["id"]}
    return task
