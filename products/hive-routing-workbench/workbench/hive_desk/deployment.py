"""Reviewed installation cutover and rollback through the same stable operator endpoint."""
from __future__ import annotations
from .native import status
from .util import require
from .workspace import now

def active(workspace):
    return workspace.get("active-deployment", "operator")

def activate(workspace, deployment_id, programme_id, note, expected=None, action="cutover"):
    require(action in {"cutover", "rollback"}, "Select cutover or rollback.")
    require(isinstance(note, str) and note.strip(), "Record the actual deployment decision.")
    deployment = status(workspace, deployment_id)
    require(deployment["observation"].get("readiness", {}).get("status") == 200,
            "The selected original native router must be ready.")
    review = workspace.get("programme-review", programme_id)
    programme = workspace.get("programme", programme_id)
    require(review and programme and review["data"]["accepted"], "Select the accepted complete native programme.")
    require(review["data"]["programmeRevision"] == programme["revision"], "Reopen the review for the current original programme.")
    require(programme["data"]["deployment"] == deployment_id, "The reviewed programme selects a different native deployment.")
    require(programme["data"]["nativeAttempt"] == deployment["data"]["currentAttempt"]["id"],
            "Review the programme from this actual original router attempt.")
    config = workspace.get("configuration-review", deployment["data"]["edition"])
    require(config and all(row["decision"] != "needs-work" for row in config["data"]["decisions"]),
            "Complete the selected original configuration review.")
    previous = active(workspace)
    require((previous and previous["revision"] == expected) or (not previous and expected is None),
            "Reopen the current deployment before changing the selected endpoint.")
    history = list(previous["data"].get("history", [])) if previous else []
    if action == "rollback":
        require(any(row["deployment"] == deployment_id for row in history),
                "Select a retained deployment that previously served this endpoint.")
    entry = {"deployment": deployment_id, "programme": programme_id, "reviewRevision": review["revision"],
             "edition": deployment["data"]["edition"], "nativeAttempt": deployment["data"]["currentAttempt"]["id"],
             "baseUrl": deployment["data"]["baseUrl"], "graphqlPath": deployment["data"]["graphqlPath"],
             "action": action, "note": note, "at": now()}
    history.append(entry)
    return workspace.save("active-deployment", "operator", {**entry, "history": history}, expected)

def rollback(workspace, deployment_id, programme_id, note, expected=None):
    return activate(workspace, deployment_id, programme_id, note, expected, action="rollback")
