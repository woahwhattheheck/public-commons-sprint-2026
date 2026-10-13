"""Authenticated file links for one retained selected-study receiving view."""
from pathlib import Path

from model import study_receiving


def read(operator, workspace_key, operation, value):
    workspace = operator.ws(workspace_key)
    if operation == "received":
        return study_receiving.catalog(
            workspace, offset=int(value.get("offset", 0)), limit=int(value.get("limit", 50)))
    result = study_receiving.detail(workspace, value.get("study_id"))

    def tickets(members):
        rows = []
        for item in members:
            path = Path(workspace.root) / item["path"]
            record = operator._ticket(
                workspace_key, str(path), {**item, "filename": path.name}, path.name)
            rows.append(record)
        return rows

    for report in result["reports"]:
        report["_downloads"] = tickets(report["members"])
    for source in result["field_sources"]:
        for report in source["reports"]:
            report["_downloads"] = tickets(report["members"])
        for packet in source["deployments"]:
            packet["_downloads"] = tickets(packet["members"])
    import gauge_receiving
    gauge_receiving.decorate(operator, workspace_key, result)
    import ensemble_receiving
    ensemble_receiving.decorate(operator, workspace_key, result)
    result["workspace_key"] = workspace_key
    return result
