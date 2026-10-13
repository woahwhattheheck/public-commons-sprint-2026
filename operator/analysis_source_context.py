"""Original Scenario analysis source-context operations and verified report transport."""
from model import analysis_source_context as native

ACTIONS = {"scenario.source_context.build"}
POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox"


def _one(payload, name):
    value = payload.get(name)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Select one " + name.replace("_", " "))
        value = value[0]
    if not isinstance(value, str) or not value:
        raise ValueError("Select the retained " + name.replace("_", " "))
    return value


def _decorate(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)
    result["workspace_key"] = workspace_key
    result["preview_url"] = ("/api/file/analysis-source-context/" + workspace_key + "/" +
                             result["id"] + "/report")
    result["_downloads"] = operator._files(workspace_key, result, workspace.root / native.KIND / result["id"])
    return result


def invoke(operator, task):
    if task["action"] not in ACTIONS:
        raise ValueError("Choose the original source-context report action")
    payload = task["payload"]
    result = native.create(operator.ws(task["workspace"]), payload["selection"],
                           expected_signature=payload["source_signature"])
    return {"id": result["id"], "analysis_id": result["analysis_id"],
            "source_signature": result["source_signature"], "link_count": len(result["links"]),
            "title": result["selection"]["title"]}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return {**native.catalog(workspace, _one(payload, "analysis_id")), "workspace_key": workspace_key}
    if operation == "preview":
        return {**native.preview(workspace, payload["selection"]), "workspace_key": workspace_key}
    if operation == "report":
        key = _one(payload, "report_id" if "report_id" in payload else "id")
        return _decorate(operator, workspace_key, native.inspect(workspace, key))
    raise ValueError("Choose an available original source-context view")


def state(operator, workspace_key):
    return {"reports": native.summaries(operator.ws(workspace_key))}


def decorate_task(operator, task):
    if task.get("action") in ACTIONS and task.get("state") == "complete":
        result = read(operator, task["workspace"], "report", {"id": task["result"]["id"]})
        task["_downloads"] = result["_downloads"]
        task["_analysis_source_context_url"] = result["preview_url"]
    return task


def file_reply(operator, workspace_key, report_id, artifact):
    workspace = operator.ws(workspace_key)
    path, expected = native.artifact(workspace, report_id, artifact)
    ticket = operator._ticket(workspace_key, path, expected, "Scenario source context / " + artifact)
    return ticket, POLICY


def verify_workspace(workspace):
    return native.verify_workspace(workspace)
