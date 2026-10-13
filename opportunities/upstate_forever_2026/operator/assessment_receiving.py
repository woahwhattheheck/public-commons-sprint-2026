"""Authenticated tickets for original assessment sources and editable editions."""
from pathlib import Path

from model.common import verify_file


def decorate(operator, workspace_key, result):
    workspace = operator.ws(workspace_key)

    def tickets(members):
        rows = []
        for item in members:
            path = verify_file(workspace.root, item)
            label = item.get("label") or path.name
            rows.append(operator._ticket(
                workspace_key, path, {**item, "filename": Path(label).name}, label))
        return rows

    for source in result.get("assessment_sources", []):
        source["_downloads"] = tickets(source.get("source_members", []))
        if source.get("native"):
            for name in ("station", "context", "parcel"):
                native = source["native"].get(name)
                if native is not None:
                    native["_downloads"] = tickets(native.get("members", []))
    return result
