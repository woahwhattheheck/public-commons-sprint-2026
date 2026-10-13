"""Scenario analysis bindings for the existing operator extension host.

TokenJunkieLabs. Scientific calculations remain in model.scenario_analysis.
"""
from __future__ import annotations

import re
from model.common import file_digest, read_json


def overview(workspace):
    """Return compact retained progress and completed-result summaries."""
    return [read_json(path) for path in sorted(
        (workspace.root / "analyses").glob("*/summary.json"))]


def invoke(workspace, payload):
    from model.scenario_analysis import analyze
    return analyze(workspace, payload)


def item(operator, workspace_key, payload, fault):
    key = payload.get("id")
    if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
        raise fault("ANALYSIS_ID", "Choose an existing retained analysis.", 422)
    workspace = operator.ws(workspace_key)
    scope = workspace.root / "analyses" / key
    if not scope.resolve().is_relative_to(workspace.root.resolve()):
        raise fault("ANALYSIS_PATH", "The analysis leaves its retained workspace.", 409)
    path = scope / "analysis.json"
    if not path.is_file():
        raise fault("ANALYSIS_INCOMPLETE", "Finish the selected analysis before opening its results.", 409)
    result = read_json(path)
    if (result.get("schema") != "upstate.scenario-analysis/v1"
            or result.get("id") != key or result.get("state") != "complete"):
        raise fault("ANALYSIS_INCOMPLETE", "Finish the selected analysis before opening its results.", 409)
    result["_downloads"] = operator._files(workspace_key, result, scope)
    result["_downloads"].append(operator._ticket(
        workspace_key, path,
        {"bytes": path.stat().st_size, "sha256": file_digest(path)},
        "Complete scenario analysis"))
    return result


def decorate_task(operator, task, fault):
    if task.get("action") == "scenario.analyze" and task.get("state") == "complete":
        task["_downloads"] = item(
            operator, task["workspace"], {"id": task["result"]["id"]}, fault)["_downloads"]
    return task
