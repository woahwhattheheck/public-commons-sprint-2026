"""Render selected original observed reports through the maintained formatter."""
import argparse
import json
import sys
from pathlib import Path

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
from model import observed_report_render as renderer

ws = Workspace(a.workspace, create=a.create_workspace,
               title="Upper Savannah observed science")
manifests = ([Path(value).resolve(strict=True) for value in a.manifest]
             if a.manifest else [(app / "observed_hydrology_context.sources.json").resolve(strict=True)])
choices = []
for manifest in manifests:
    collection = ws.import_sources(manifest)
    matches = [entry for entry in collection["entries"]
               if entry.get("metadata", {}).get("report_schema") == "upstate.observed-report/v1"]
    if len(matches) != 1:
        raise ValueError("Select exactly one original observed-report source in " + str(manifest))
    choices.append({"source_collection_id": collection["id"], "source_id": matches[0]["id"]})
contact = json.loads(Path(a.contact_json).read_text(encoding="utf-8")) if a.contact_json else None
preview = renderer.prepare(ws, choices, title=a.title, contact=contact, manifest_paths=manifests)
if a.preview:
    result = {key: value for key, value in preview.items() if key != "source_records"}
    result["output"] = str(Path(a.output).resolve()) if a.output else None
else:
    output = Path(a.output).resolve()
    result = renderer.render(ws, preview, output)
    if a.archive:
        receiving = renderer.archive_report(ws, output, result, a.archive,
                                            a.receive_directory, app_root=app)
        result = {**result, "receiving": receiving}
print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
