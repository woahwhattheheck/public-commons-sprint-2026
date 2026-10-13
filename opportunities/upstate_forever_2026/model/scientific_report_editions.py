"""Read immutable saved scientific report editions inside their Workspace.

The native report desk and customer-review preparation share this one retained
edition contract. Original output files, ordered source binding and rendering
identity are verified together before another workflow consumes the report.
"""
from __future__ import annotations

from pathlib import Path

from .common import atomic_json, describe_file, digest, held, identifier, read_json, verify_file
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
    if value.get("capture_origin") is not None:
        from .scientific_report_capture import verify_origin
        verify_origin(workspace, value, selected)
    return value, selected, result


def files(value, selected):
    selected = Path(selected)
    members = dict(value["files"])
    for role, name in (("operation", "operation.json"), ("edition", "edition.json")):
        if role in members:
            raise ValueError("Original report output uses a reserved saved-edition role")
        members[role] = describe_file(selected, selected / name)
    return members


class PreviewChanged(ValueError):
    """The selected native source edition differs from its reviewed preview."""


def preview(workspace, payload):
    """Prepare the same ordered-source preview used by the SourceReports queue."""
    from . import observed_report_render as renderer
    result = renderer.prepare(workspace, payload.get("sources"), title=payload.get("title"),
                              contact=payload.get("contact"))
    key = digest(result["render_identity"])
    return {**result, "id": key, "existing": (directory(workspace, key) / "edition.json").is_file()}



def validate_request(workspace, payload, identity):
    """Match an original report request without binding it to today's renderer."""
    supplied = payload.get("sources")
    if not isinstance(supplied, list) or not supplied:
        raise ValueError("Choose one or more retained scientific report sources")
    choices = observed_context.source_choices({"observed_context_sources": supplied})
    if choices != observed_context.source_choices(identity["selection"]):
        raise PreviewChanged("The retained report belongs to another ordered source selection.")
    titles = []
    for choice in choices:
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        titles.append(entry["title"])
    title = payload.get("title")
    if title is not None and (not isinstance(title, str) or not title.strip()):
        raise ValueError("Enter a nonempty report title")
    resolved = title.strip() if title is not None else (
        titles[0] if len(titles) == 1 else "Observed science: " + "; ".join(titles))
    contact = payload.get("contact")
    if contact is None:
        contact = {}
    if (not isinstance(contact, dict)
            or any(not isinstance(contact.get(name, ""), str)
                   for name in ("name", "organization", "email"))):
        raise ValueError("Report contact details must be text")
    if identity.get("title") != resolved or identity.get("contact") != contact:
        raise PreviewChanged("The retained report belongs to another title or contact.")
    if observed_context.bind(workspace, identity["selection"]) != identity.get("binding"):
        raise PreviewChanged("The retained report's original scientific source edition changed.")
    return choices


def _save_edition(workspace, identity, result):
    """Publish the edition from the original completed native operation."""
    key = digest(identity)
    selected = directory(workspace, key)
    value = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
             "title": identity["title"], "render_identity": identity,
             **{name: result[name] for name in (
                 "state", "operation_id", "source_count", "section_count",
                 "figure_count", "sources", "files")}}
    if (selected / "edition.json").is_file():
        previous = read_json(selected / "edition.json")
        if previous.get("capture_origin") is not None:
            original = dict(previous)
            original.pop("capture_origin")
            if original != value:
                raise ValueError("The completed report differs from its adopted original edition.")
            value = previous
    atomic_json(selected / "edition.json", value, immutable=True)
    inspect(workspace, key)
    return {"scientific_report_edition_id": key, "title": value["title"],
            "state": "complete", "source_count": value["source_count"],
            "operation_id": value["operation_id"]}


def render_prepared(workspace, prepared):
    """Complete a retained original preview through the existing native renderer.

    An original preview can retain its source-host path after Workspace transfer.
    Its project belongs to the caller's retained operation; source bindings and
    installed rendering bodies are checked by the same original rendering engine.
    """
    from . import observed_report_render as renderer
    identity = prepared["render_identity"]
    key = digest(identity)
    if (prepared.get("schema") != "upstate.observed-report-preview/v1"
            or prepared.get("id") != key
            or prepared.get("operation_id") != "observed-report-" + key[:20]
            or any(prepared.get(name) != identity.get(name)
                   for name in ("title", "selection", "binding", "workspace"))):
        raise ValueError("Use the retained original scientific report preview")
    choices = observed_context.source_choices(identity["selection"])
    if (prepared.get("source_count") != len(choices)
            or [{"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]}
                for row in prepared.get("sources", [])] != choices):
        raise ValueError("The original report preview changed its ordered source selection")
    selected = directory(workspace, key)
    # The original renderer owns report locking, native file reuse, original
    # source retention, figure drawing and its installed-code identity checks.
    with held(workspace.root / ".workspace.lock"):
        result = renderer.render(workspace, prepared, selected)
        return _save_edition(workspace, identity, result)


def render(workspace, payload):
    """Reopen completed original output, or render the explicitly reviewed preview."""
    key = payload.get("preview_id")
    if key is not None:
        selected = directory(workspace, key)
        # Rendering publishes operation.json before edition.json and the queue's
        # completion record. Reconcile that exact completed effect first, even
        # when installed formatting source has advanced since this request.
        if (selected / "operation.json").is_file():
            with held(workspace.root / ".workspace.lock"):
                identity = read_json(selected / "selection.json")
                result = read_json(selected / "operation.json")
                if (identity.get("schema") != "upstate.observed-report-native/v1"
                        or digest(identity) != key
                        or result.get("state") != "complete"
                        or result.get("operation_id") != "observed-report-" + key[:20]
                        or any(result.get(name) != value for name, value in identity.items())):
                    raise ValueError("The retained completed report differs from its original preview")
                choices = validate_request(workspace, payload, identity)
                if (result.get("source_count") != len(choices)
                        or [{"source_collection_id": row["source_collection_id"],
                             "source_id": row["source_id"]} for row in result.get("sources", [])]
                        != choices):
                    raise ValueError("The completed report changed its ordered original sources")
                for item in result["files"].values():
                    verify_file(selected, item)
                return _save_edition(workspace, identity, result)
    prepared = preview(workspace, payload)
    if payload.get("preview_id") != prepared["id"]:
        raise PreviewChanged("Preview this exact ordered study selection before preparing its report.")
    return render_prepared(workspace, prepared)
