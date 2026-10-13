"""Portfolio baseline continuation through the original authenticated task queue."""
from __future__ import annotations

from model.common import identifier
from model import portfolio_pairing as pairing
from model.portfolios import get_portfolio

ACTIONS = {"portfolio.baseline.complete"}


def _inputs(operator, workspace_key, payload):
    workspace = operator.ws(workspace_key)
    record = get_portfolio(workspace, identifier(payload.get("portfolio_id")), details=False)
    run = workspace.inspect_run(identifier(payload.get("evaluation_run_id")))
    return workspace, record, run


def read(operator, workspace_key, operation, payload):
    if operation != "pairing":
        raise ValueError("Choose the portfolio baseline pairing.")
    workspace, record, run = _inputs(operator, workspace_key, payload)
    return pairing.inspect(workspace, record, run)


def invoke(operator, workspace_key, action, payload):
    if action not in ACTIONS:
        raise ValueError("Choose the original portfolio baseline continuation.")
    workspace, record, run = _inputs(operator, workspace_key, payload)
    baseline = pairing.resolve(workspace, record, run,
                               baseline_run_id=payload.get("baseline_run_id"), execute=True)
    original = pairing.context(workspace, record, run)
    title = str(payload.get("title") or record["title"] + " native scenario analysis").strip()
    return {"schema": "upstate.portfolio-baseline-completion/v1",
            "portfolio_id": record["id"], "evaluation_run_id": run["id"],
            "baseline_run_id": baseline["id"], "state": "complete",
            "analysis_selection": {"title": title, "baseline_run_id": baseline["id"],
                                   "scenario_run_ids": [run["id"]]},
            "native_pair": pairing.binding(original, run, baseline)}


def decorate_task(operator, task):
    if task.get("action") in ACTIONS and task.get("state") == "complete":
        result = task.get("result") or {}
        if result.get("baseline_run_id"):
            task["_item"] = {"kind": "runs", "id": result["baseline_run_id"]}
    return task
