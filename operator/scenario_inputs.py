"""Native input-change desk on the existing authorized operator queue."""
from __future__ import annotations
import copy
from model import scenario_inputs
from model.common import read_json, relative_file

ACTION = "scenario.inputs.compare"


def _one(payload, key, default=None):
    value = payload.get(key, default)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Supply one " + key)
        return value[0]
    return value


def invoke(operator, task):
    if task["action"] != ACTION:
        raise ValueError("Choose the native input comparison action")
    payload = task["payload"]
    if not isinstance(payload, dict) or set(payload) != {"baseline_run_id", "alternative_run_id"}:
        raise ValueError("Choose the baseline and alternative completed native runs")
    return scenario_inputs.analyze_inputs(operator.ws(task["workspace"]), **payload)


def read(operator, workspace_key, operation, payload):
    if not isinstance(payload, dict):
        raise ValueError("Use the original operator request object")
    ws = operator.ws(workspace_key)
    if operation == "catalog":
        offset, limit = int(_one(payload, "offset", 0)), int(_one(payload, "limit", 100))
        if offset < 0 or not 1 <= limit <= 200:
            raise ValueError("Choose a valid native-run catalogue page")
        profiles = {row["id"]: row["title"] for row in ws._list("profiles")}
        scenarios = {row["id"]: row["title"] for row in ws._list("scenarios")}
        runs = []
        for path in sorted((ws.root / "runs").glob("*/run.json")):
            row = read_json(path)
            if row.get("state") == "complete":
                selection = row["selection"]
                runs.append({"id": row["id"], "selection": selection,
                             "profile_title": profiles.get(selection["profile_id"], selection["profile_id"]),
                             "scenario_title": scenarios.get(selection["scenario_id"], selection["scenario_id"])})
        reports = [{key: row[key] for key in ("id", "title", "created_at", "models",
                                              "baseline_run_id", "alternative_run_id")}
                   for row in scenario_inputs.list_reports(ws)]
        return {"runs": runs[offset:offset + limit], "offset": offset, "total": len(runs),
                "next_offset": offset + limit if offset + limit < len(runs) else None,
                "reports": sorted(reports, key=lambda row: row["created_at"], reverse=True)}
    if operation == "report":
        row = scenario_inputs.get_report(ws, _one(payload, "id"), verify=False)
        result = copy.deepcopy(row)
        downloads = []
        for name, item in row["files"].items():
            ticket = operator._ticket(workspace_key, relative_file(ws.root, item["path"]),
                                      item, name.replace("_", " "))
            ticket["artifact_id"] = name
            downloads.append(ticket)
        comparison = row["outcome_comparison"]
        for name, item in comparison["artifacts"].items():
            path = relative_file(ws.root, comparison["directory"] + "/" + item["path"])
            ticket = operator._ticket(workspace_key, path, item, name + " original paired change")
            ticket["artifact_id"] = "outcome_" + name
            downloads.append(ticket)
        result["_downloads"] = downloads
        return result
    raise ValueError("Choose the input-change catalogue or retained report")


def decorate_task(operator, task):
    if task.get("action") == ACTION and task.get("state") == "complete":
        task["_downloads"] = read(operator, task["workspace"], "report",
                                   {"id": task["result"]["id"]})["_downloads"]
    return task


def verify_workspace(workspace):
    rows = scenario_inputs.list_reports(workspace)
    for row in rows:
        scenario_inputs.get_report(workspace, row["id"], verify=True)
    return {"input_effect_reports": len(rows)}
