"""Retain parameter-study identities, native cases and complete result exports.

Used inside the original Workspace capture/restore locks. Original archive
members are already independently byte-verified by the native transfer; this
joins them to the maintained study selection and case/result descriptors.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import identifier, relative_file

FORMAT = "upstate.parameter-study-receiving/v1"


def verify_parameter_studies(workspace, verified_members):
    from . import parameter_studies
    def member(relative):
        relative = Path(relative).as_posix()
        original = relative_file(workspace.root, relative)
        retained = verified_members.get("workspace/" + relative)
        if retained is None or original.stat().st_size != retained["bytes"]:
            raise ValueError("The original study file is absent from this Workspace edition: " + relative)
        return {"path": relative, "bytes": retained["bytes"], "sha256": retained["sha256"]}

    summaries = []
    for retained in parameter_studies.list_experiments(workspace):
        key = identifier(retained["id"])
        state = parameter_studies.inspect(workspace, key)
        state_file = member("experiments/" + key + "/experiment.json")
        selection_file = member("experiment-specs/" + key + ".json")
        artifacts = {}
        for label, descriptor in sorted(state.get("artifacts", {}).items()):
            name = Path(descriptor["path"])
            if name.is_absolute() or ".." in name.parts or chr(92) in descriptor["path"]:
                raise ValueError("The original study export leaves its retained directory")
            relative = "experiments/" + key + "/" + name.as_posix()
            retained_file = verified_members.get("workspace/" + relative)
            captured = member(relative) if retained_file is not None else None
            matched = captured is not None and all(
                captured[field] == descriptor[field] for field in ("bytes", "sha256"))
            artifacts[label] = {
                **deepcopy(descriptor), "workspace_path": relative,
                "receiving_state": "matched" if matched else "changed" if captured else "missing",
                "captured_file": captured}
        summaries.append({
            "id": key, "title": state["selection"]["title"],
            "purpose": state["selection"]["purpose"], "design": state["selection"]["design"],
            "state": state["state"], "models": deepcopy(state["models"]),
            "pollutants": deepcopy(state["pollutants"]),
            "baseline_run_id": state["selection"]["baseline_run_id"],
            "baseline_selection": deepcopy(state["baseline_selection"]),
            "difference_maps": state["selection"]["difference_maps"],
            "comparison_id": state.get("comparison_id"),
            "progress": deepcopy(state["progress"]),
            "cases": [{"id": row["id"], "label": row["label"], "run_id": row["run_id"],
                       "profile_id": row["profile_id"], "state": row["state"]}
                      for row in state["cases"]],
            "artifacts": artifacts, "state_file": state_file, "selection_file": selection_file})
    return {"schema": FORMAT, "workspace_id": workspace.project["id"], "studies": summaries}
