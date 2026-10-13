"""Read immutable saved scientific report editions inside their Workspace.

The native report desk and customer-review preparation share this one retained
edition contract. Original output files, ordered source binding and rendering
identity are verified together before another workflow consumes the report.
"""
from __future__ import annotations

from pathlib import Path

from .common import describe_file, digest, identifier, read_json, verify_file
from . import observed_context

KIND = "scientific-report-editions"
SCHEMA = "upstate.scientific-report-edition/v1"


def directory(workspace, key):
    key = identifier(key)
    root = Path(workspace.root).resolve()
    selected = root / KIND / key
    if selected.resolve().is_relative_to(root) is False:
        raise ValueError("Keep the saved report inside its original Workspace")
    return selected


def record(workspace, key):
    key = identifier(key)
    selected = directory(workspace, key)
    value = read_json(selected / "edition.json")
    if (value.get("schema") != SCHEMA or value.get("id") != key
            or value.get("project_id") != workspace.project["id"]
            or digest(value.get("render_identity")) != key):
        raise ValueError("The saved report edition identity changed")
    return value, selected


def inspect(workspace, key):
    key = identifier(key)
    value, selected = record(workspace, key)
    result = read_json(selected / "operation.json")
    identity = value["render_identity"]
    if (result.get("state") != "complete"
            or result.get("operation_id") != "observed-report-" + key[:20]
            or any(result.get(name) != item for name, item in identity.items())
            or result.get("files") != value.get("files")
            or read_json(selected / "selection.json") != identity):
        raise ValueError("The completed report differs from its saved selection")
    if observed_context.bind(workspace, identity["selection"]) != identity["binding"]:
        raise ValueError("The saved report's original scientific source edition changed")
    for item in result["files"].values():
        verify_file(selected, item)
    return value, selected, result


def files(value, selected):
    selected = Path(selected)
    members = dict(value["files"])
    for role, name in (("operation", "operation.json"), ("edition", "edition.json")):
        if role in members:
            raise ValueError("Original report output uses a reserved saved-edition role")
        members[role] = describe_file(selected, selected / name)
    return members
