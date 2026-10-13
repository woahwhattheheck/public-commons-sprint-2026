"""Original Operator adapter for retained source-update Programme successors."""
from model import programme_source_updates as native

ACTION = "compute.programme.source-update"


def _one(payload, name):
    value = payload.get(name)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Choose one " + name.replace("_", " "))
        value = value[0]
    if not isinstance(value, str) or not value:
        raise ValueError("Choose the original " + name.replace("_", " "))
    return value


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    key = _one(payload, "programme_id")
    if operation == "catalog":
        result = native.catalog(workspace, key)
    elif operation == "preview":
        result = native.preview(workspace, key, _one(payload, "refresh_plan_id"),
                                title=payload.get("title"))
    else:
        raise ValueError("Choose an available Programme source-update view")
    return {**result, "workspace_key": workspace_key}


def invoke(operator, task):
    if task["action"] != ACTION:
        raise ValueError("Choose the saved Programme source-update action")
    payload = task["payload"]
    return native.create(operator.ws(task["workspace"]), _one(payload, "programme_id"),
                         _one(payload, "refresh_plan_id"), title=payload.get("title"),
                         expected_preview_id=_one(payload, "expected_preview_id"))


def decorate_task(operator, task):
    if task.get("action") != ACTION:
        return task
    result = task.get("result") or {}
    key = result.get("programme_id") or result.get("id") or task["payload"].get("programme_id")
    if key:
        from model.compute_programme import ComputeProgrammes
        try:
            manager = ComputeProgrammes(operator.ws(task["workspace"]))
            value = manager.status(key, include_ensemble_candidates=False)
            task["programme"] = {name: value[name] for name in
                ("id", "title", "state", "phase", "counts", "pause_requested") if name in value}
        except (OSError, KeyError, ValueError) as error:
            task["programme_report_error"] = str(error)
    return task


def verify_workspace(workspace):
    return native.verify_workspace(workspace)
