"""Authenticated original Parameter source downloads in received Studies."""
from pathlib import Path


def decorate(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)

    def tickets(members):
        rows = []
        for member in members:
            path = Path(workspace.root) / member["path"]
            rows.append(operator._ticket(
                workspace_key, str(path), member,
                member.get("label") or path.name))
        return rows

    for source in result.get("parameter_study_sources", []):
        source["_downloads"] = tickets(source["source_members"])
        source["_result_downloads"] = tickets(source["result_members"])
    return result
