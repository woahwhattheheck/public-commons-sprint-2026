"""Authenticated existing file tickets for received Gauge scientific sources."""


def decorate(operator, workspace_key, result):
    from pathlib import Path
    from model.common import verify_file

    workspace = operator.ws(workspace_key)

    def tickets(rows):
        result = []
        for item in rows:
            path = verify_file(workspace.root, item)
            label = item.get("label") or Path(path).name
            ticket = operator._ticket(workspace_key, path,
                {**item, "filename": Path(label).name}, label)
            result.append(ticket)
        return result

    for source in result.get("gauge_sources", []):
        source["_downloads"] = tickets(source.get("source_members", []))
        native = source.get("native")
        if native:
            for name in ("gauge", "station", "regional"):
                native[name]["_downloads"] = tickets(native[name].get("members", []))
    return result
