"""Authenticated original-operator continuation for a retained scenario analysis."""
from model import scenario_analysis_delivery

def read(operator, workspace_key, operation, payload):
    if operation != "selection":
        raise ValueError("Choose the retained scenario-analysis delivery selection")
    workspace = operator.ws(workspace_key)
    value = scenario_analysis_delivery.describe(
        workspace, (payload or {}).get("analysis_id") or (payload or {}).get("id"))
    return {**value, "workspace_key": workspace_key}
