"""Ordinary authenticated downloads for received original native studies."""
from pathlib import Path


def decorate(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)

    def tickets(members):
        rows = []
        for item in members:
            path = Path(workspace.root) / item["path"]
            rows.append(operator._ticket(
                workspace_key, str(path),
                {**item, "filename": item.get("filename") or Path(item.get("label") or path.name).name},
                item.get("label") or path.name))
        return rows

    for row in result.get("native_ensemble_sources", []):
        row["_downloads"] = tickets(row["source_members"])
        row["_numeric_downloads"] = tickets(row["numeric_members"])
    return result
