"""Authenticated original files for received selected-watershed comparisons."""


def decorate(operator, workspace_key, result):
    from pathlib import PurePosixPath
    from model.common import verify_file

    workspace = operator.ws(workspace_key)

    def tickets(rows):
        output = []
        for item in rows:
            path = verify_file(workspace.root, item)
            label = item.get("label") or path.name
            output.append(operator._ticket(
                workspace_key, path, {**item, "filename": PurePosixPath(label).name}, label))
        return output

    for source in result.get("observed_landcover_sources", []):
        source["_downloads"] = tickets(source.get("source_members", []))
        if source.get("native") is not None:
            source["native"]["_downloads"] = tickets(source["native"].get("members", []))
    return result
