"""Compose original workspace-backed operating views into the current operator."""
from __future__ import annotations

import json
from pathlib import Path

DECLARATION = Path(__file__).resolve().parents[1] / "integration" / "operator_session_composition.json"


def read_declaration():
    value = json.loads(DECLARATION.read_text(encoding="utf-8"))
    if value.get("schema") != "upstate.operator-session-integration/v1":
        raise ValueError("Choose the original current operator-session composition.")
    return value


def completed(source, patch):
    """Accept only a complete, uniquely retained original postimage."""
    candidates = (patch["after"], *patch.get("accepted_after", ()))
    matches = [text for text in candidates if text in source]
    if not matches:
        return False
    if len(matches) != 1 or source.count(matches[0]) != 1:
        raise ValueError("Ambiguous completed source join: " + patch["id"])
    if matches[0] == patch["after"] and source.count(patch["marker"]) != 1:
        raise ValueError("Ambiguous completed source marker: " + patch["id"])
    return True


def patch_text(source, patches):
    for patch in patches:
        if completed(source, patch):
            continue
        if patch["marker"] in source:
            raise ValueError("Compose the current source at: " + patch["id"])
        candidates = (patch["before"], *patch.get("accepted_before", ()))
        matches = [text for text in candidates if text and text in source]
        if len(matches) != 1 or source.count(matches[0]) != 1:
            raise ValueError(patch["id"] + ": expected one complete original source anchor")
        source = source.replace(matches[0], patch["after"], 1)
    for patch in patches:
        if not completed(source, patch):
            raise ValueError("An overlapping source join changed: " + patch["id"])
    return source


def transform(path, source):
    declaration = read_declaration()
    if path not in declaration["patches"]:
        raise ValueError("The native session composition does not own " + str(path))
    return patch_text(source, declaration["patches"][path])


def patch_server(source):
    return transform("operator/server.py", source)


def patch_app(source):
    return transform("operator/web/app.mjs", source)


def patch_index(source):
    return transform("operator/web/index.html", source)


def patch_extensions(source):
    return transform("install_extensions.py", source)
