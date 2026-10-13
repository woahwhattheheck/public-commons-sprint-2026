"""Original receptor profiles for the map-atlas source-context planner."""
from __future__ import annotations

from pathlib import Path
from model.common import describe_file, read_json


def read(operator, workspace_key, operation, payload, fault=None):
    if operation != "source-context":
        raise ValueError("Unknown map-atlas source operation")
    workspace = operator.ws(workspace_key)
    application = Path(__file__).resolve().parent.parent
    profile = application / "source" / "receptor-profiles" / "utility-focus-20261012.json"
    profiles = []
    if profile.is_file():
        spec = read_json(profile)
        profiles.append({"id": "utility-focus-20261012", "title": spec["title"],
                         "spec": spec, "source": describe_file(application, profile)})
    return {"workspace_key": workspace_key, "project_id": workspace.project["id"],
            "receptor_profiles": profiles}
