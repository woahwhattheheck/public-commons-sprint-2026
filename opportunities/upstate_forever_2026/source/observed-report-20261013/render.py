"""Render selected original observed reports through the maintained formatter."""
import argparse
import json
import sys
from pathlib import Path


def retained_preview(workspace, directory, choices, title, contact, manifests):
    """Reopen an original request before considering today's rendering edition."""
    from model.common import digest, read_json, verify_file
    from model.scientific_report_editions import validate_request

    identity_path = directory / "selection.json"
    operation_path = directory / "operation.json"
    preview_path = directory / "render-preview.json"
    payload = {"sources": choices, "title": title, "contact": contact}
    if operation_path.is_file():
        if not identity_path.is_file():
            raise ValueError("The completed report lacks its original selection.json")
        identity = read_json(identity_path)
        result = read_json(operation_path)
        key = digest(identity)
        if (identity.get("schema") != "upstate.observed-report-native/v1"
                or identity.get("workspace") != str(workspace.root)
                or result.get("state") != "complete"
                or result.get("operation_id") != "observed-report-" + key[:20]
                or any(result.get(name) != value for name, value in identity.items())):
            raise ValueError("The completed output differs from its original report selection")
        original_choices = validate_request(workspace, payload, identity)
        if (result.get("source_count") != len(original_choices)
                or [{"source_collection_id": row["source_collection_id"],
                     "source_id": row["source_id"]} for row in result.get("sources", [])]
                   != original_choices):
            raise ValueError("The completed report changed its ordered original sources")
        for descriptor in result["files"].values():
            verify_file(directory, descriptor)
        # The original renderer reopens the completed operation under its normal
        # lock and verifies its files again. Formatting code is not invoked.
        return {"schema": "upstate.observed-report-preview/v1", "state": "preview",
                "render_identity": identity, "operation_id": result["operation_id"],
                "title": identity["title"], "selection": identity["selection"],
                "binding": identity["binding"], "workspace": identity["workspace"],
                "source_count": result["source_count"], "sources": result["sources"],
                "source_records": []}

    current = renderer.prepare(workspace, choices, title=title, contact=contact,
                               manifest_paths=manifests)
    if preview_path.is_file():
        prepared = read_json(preview_path)
        identity = prepared.get("render_identity", {})
        if (prepared.get("schema") != "upstate.observed-report-preview/v1"
                or identity.get("schema") != "upstate.observed-report-native/v1"
                or identity.get("workspace") != str(workspace.root)
                or prepared.get("operation_id") != "observed-report-" + digest(identity)[:20]
                or any(prepared.get(name) != identity.get(name)
                       for name in ("title", "selection", "binding", "workspace"))):
            raise ValueError("The original saved report preview is inconsistent")
        validate_request(workspace, payload, identity)
        if (prepared.get("source_count") != len(choices)
                or [{"source_collection_id": row["source_collection_id"],
                     "source_id": row["source_id"]} for row in prepared.get("sources", [])] != choices):
            raise ValueError("The original preview changed its ordered source selection")
        if identity_path.is_file() and read_json(identity_path) != identity:
            raise ValueError("The saved preview differs from the original rendering selection")
    elif identity_path.is_file():
        # Older CLI editions retained selection.json without a full preview.
        identity = read_json(identity_path)
        if (identity.get("schema") != "upstate.observed-report-native/v1"
                or identity.get("workspace") != str(workspace.root)):
            raise ValueError("Resume the original report in its authoring Workspace")
        validate_request(workspace, payload, identity)
        prepared = {**current, "render_identity": identity,
                    "operation_id": "observed-report-" + digest(identity)[:20],
                    **{name: identity[name] for name in ("title", "selection", "binding", "workspace")}}
        for name in ("presentation", "rendering_sources"):
            if name in identity:
                prepared[name] = identity[name]
            else:
                prepared.pop(name, None)
    else:
        prepared = current
        identity = current["render_identity"]

    if (identity.get("report_version") != current["render_identity"].get("report_version")
            or (identity.get("rendering_sources") is not None
                and identity["rendering_sources"] != current["render_identity"]["rendering_sources"])):
        raise ValueError(
            "This original report has incomplete rendering and retains different renderer bodies. "
            "Resume with those retained bodies, or choose a new --output for a new rendering edition; "
            "the original output remains unchanged.")
    return prepared


p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--app-root", required=True)
p.add_argument("--workspace", required=True)
p.add_argument("--manifest", action="append", default=[],
               help="Original report manifest; repeat in report order. Default: application regional context")
p.add_argument("--output", help="Retained output directory; required unless --preview")
p.add_argument("--title", help="Title for this composed report; retained in its immutable selection")
p.add_argument("--preview", action="store_true",
               help="Import and verify original sources, then print selections and bindings without rendering")
p.add_argument("--contact-json")
p.add_argument("--create-workspace", action="store_true")
p.add_argument("--archive", help="Complete original Workspace/application/report ZIP; reused after verification")
p.add_argument("--receive-directory", help="Independently restore that same archive into this directory")
a = p.parse_args()
if not a.preview and not a.output:
    p.error("--output is required for native report rendering")
if a.receive_directory and not a.archive:
    p.error("--receive-directory requires --archive")
if a.preview and (a.archive or a.receive_directory):
    p.error("Archive receiving continues a rendered report; omit --preview")
if a.title is not None and not a.title.strip():
    p.error("--title must contain a report title")

app = Path(a.app_root).resolve(strict=True)
sys.path.insert(0, str(app))
from model.workspace import Workspace
from model import observed_context
from model import observed_report_render as renderer

ws = Workspace(a.workspace, create=a.create_workspace,
               title="Upper Savannah observed science")
manifests = ([Path(value).resolve(strict=True) for value in a.manifest]
             if a.manifest else [(app / "observed_hydrology_context.sources.json").resolve(strict=True)])
choices = []
for manifest in manifests:
    collection = ws.import_sources(manifest)
    matches = [entry for entry in collection["entries"]
               if (entry.get("role") == observed_context.ROLE
                   or (entry.get("metadata") or {}).get("report_schema") == observed_context.SCHEMA)]
    if len(matches) != 1:
        raise ValueError("Select exactly one original observed-report source in " + str(manifest))
    choices.append({"source_collection_id": collection["id"], "source_id": matches[0]["id"]})
contact = json.loads(Path(a.contact_json).read_text(encoding="utf-8")) if a.contact_json else None
if a.preview:
    preview = renderer.prepare(ws, choices, title=a.title, contact=contact, manifest_paths=manifests)
    result = {key: value for key, value in preview.items() if key != "source_records"}
    result["output"] = str(Path(a.output).resolve()) if a.output else None
else:
    from model.common import atomic_json
    output = Path(a.output).resolve()
    preview = retained_preview(ws, output, choices, a.title, contact, manifests)
    # Capture a new full preview before rendering. Original completed output may
    # predate this receipt and remains readable without adding or rewriting it.
    if not (output / "operation.json").is_file():
        output.mkdir(parents=True, exist_ok=True)
        atomic_json(output / "render-preview.json", preview, immutable=True)
    result = renderer.render(ws, preview, output)
    if a.archive:
        receiving = renderer.archive_report(ws, output, result, a.archive,
                                            a.receive_directory, app_root=app)
        result = {**result, "receiving": receiving}
print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
