"""Original receptor profiles for the map-atlas source-context planner."""
from __future__ import annotations

from pathlib import Path
from model.common import describe_file, read_json
from model.atlas_reviews import attach


def read(operator, workspace_key, operation, payload, fault=None):
    if operation in {"reviews", "review"}:
        from model.atlas_reviews import collection, open_review
        workspace = operator.ws(workspace_key)
        value = payload or {}
        reviewer = operator.spatial_reviews[workspace_key]
        if operation == "reviews":
            return {"workspace_key": workspace_key,
                    "collection": collection(workspace, reviewer, value.get("delivery_id"))}
        return {"workspace_key": workspace_key,
                "target": open_review(workspace, reviewer, value.get("delivery_id"), value.get("review_id"))}
    if operation == "compare":
        from model.atlas_comparison import comparison_target
        workspace = operator.ws(workspace_key)
        value = payload or {}
        target = comparison_target(
            workspace, operator.spatial_reviews[workspace_key], value.get("delivery_id"),
            value.get("left"), value.get("right"), value.get("mode", "compare"))
        return {"workspace_key": workspace_key, "target": attach(target)}
    if operation == "inspect":
        from model.atlas_spatial import panel_target
        workspace = operator.ws(workspace_key)
        value = payload or {}
        target = panel_target(workspace, operator.spatial_reviews[workspace_key],
                              value.get("delivery_id"), value.get("map_key"),
                              value.get("panel_index"))
        return {"workspace_key": workspace_key, "target": attach(target)}
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
