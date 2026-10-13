"""Original geographic-case downloads in the existing received Study reader."""
from pathlib import Path


def decorate(operator, workspace_key, result):
    cases = result.get("geographic_cases", [])
    if not cases:
        return result
    from source_tools.geographic_headwaters_handover import _operator_choices

    workspace = operator.ws(workspace_key)
    for case in cases:
        if case["project_id"] != workspace.project["id"]:
            raise ValueError("Open the geographic case in its original received project.")
        case["_downloads"] = [
            operator._ticket(workspace_key, str(Path(workspace.root) / member["path"]),
                             member, member["label"])
            for member in case["members"]
        ]
        case["_choices"] = _operator_choices(case)
    return result
