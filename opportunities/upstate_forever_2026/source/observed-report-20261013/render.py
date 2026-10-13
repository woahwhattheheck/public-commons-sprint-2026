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
a = p.parse_args()
if not a.preview and not a.output:
    p.error("--output is required for native report rendering")
if a.title is not None and not a.title.strip():
    p.error("--title must contain a report title")

app = Path(a.app_root).resolve(strict=True)
sys.path.insert(0, str(app))
from model.workspace import Workspace
from model.common import atomic_json, describe_file, digest, held, verify_file
from model import observed_context, scientific_report

ws = Workspace(a.workspace, create=a.create_workspace,
               title="Upper Savannah observed science")
manifests = ([Path(value).resolve(strict=True) for value in a.manifest]
             if a.manifest else [(app / "observed_hydrology_context.sources.json").resolve(strict=True)])
sources, choices, records = [], [], []
seen = set()
for manifest in manifests:
    collection = ws.import_sources(manifest)
    matches = [entry for entry in collection["entries"]
               if entry.get("metadata", {}).get("report_schema") == "upstate.observed-report/v1"]
    if len(matches) != 1:
        raise ValueError("Select exactly one original observed-report source in " + str(manifest))
    entry = matches[0]
    choice = {"source_collection_id": collection["id"], "source_id": entry["id"]}
    key = (choice["source_collection_id"], choice["source_id"])
    if key in seen:
        raise ValueError("An original report source was selected more than once: " + entry["title"])
    seen.add(key)
    choices.append(choice)
    sources.append({**choice, "title": entry["title"], "manifest_path": str(manifest),
                    "vintage": entry["vintage"], "uri": entry["uri"],
                    "body_bytes": entry["body"]["bytes"], "body_sha256": entry["body"]["sha256"]})
    role = "OBSERVED_CONTEXT" if len(choices) == 1 else "OBSERVED_CONTEXT_%03d" % len(choices)
    record = {"id": role, "source_id": entry["id"], "title": entry["title"],
              "vintage": entry["vintage"], "uri": entry["uri"],
              "sha256": entry["body"]["sha256"]}
    if len(manifests) > 1:
        record["selection"] = choice
    records.append(record)

selection = {"source_roles": {"OBSERVED_CONTEXT": choices[0]}}
if len(choices) > 1:
    selection["observed_context_sources"] = choices
bound = observed_context.bind(ws, selection)
if bound is None:
    raise ValueError("The original observed-report source was not selected")
selection["observed_context_binding"] = bound
title = a.title.strip() if a.title is not None else (
    sources[0]["title"] if len(sources) == 1
    else "Observed science: " + "; ".join(source["title"] for source in sources))
contact = {"name": "Upper Savannah project team", "organization": "Internal scientific review", "email": ""}
if a.contact_json:
    contact = json.loads(Path(a.contact_json).read_text(encoding="utf-8"))
output = Path(a.output).resolve() if a.output else None
identity = {"schema": "upstate.observed-report-native/v1", "workspace": str(ws.root),
            "selection": selection, "binding": bound, "contact": contact,
            "report_version": scientific_report.REPORT_VERSION}
# Preserve the historical single-report identity when its title is unchanged.
if len(choices) > 1 or a.title is not None:
    identity["title"] = title
if a.preview:
    print(json.dumps({
        "schema": "upstate.observed-report-preview/v1", "state": "preview",
        "title": title, "source_count": len(sources), "sources": sources,
        "selection": selection, "binding": bound, "workspace": str(ws.root),
        "output": str(output) if output else None,
        "render_identity": identity, "operation_id": "observed-report-" + digest(identity)[:20],
    }, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
    raise SystemExit(0)

output.mkdir(parents=True, exist_ok=True)
with held(output / ".observed-report.lock"):
    atomic_json(output / "selection.json", identity, immutable=True)
    state = {"files": {}}
    product = observed_context.collect(ws, selection, output, state)
    if product is None or product["binding"] != bound:
        raise ValueError("The rendered source differs from the original selection")
    files = dict(product["files"])
    for item in files.values():
        verify_file(output, item)
    scientific_report.report_pdf(output / "report.pdf", title, product["sections"],
                                 contact=contact, source_records=records)
    files.update(scientific_report.write_companions(
        output, title, product["sections"], contact=contact, source_records=records,
        binding={"observed_context": bound, "workspace": str(ws.root), "selection": selection}))
    files["report_pdf"] = describe_file(output, output / "report.pdf")
    files["selection"] = describe_file(output, output / "selection.json")
    for item in files.values():
        verify_file(output, item)
    result = {
        **identity, "state": "complete", "operation_id": "observed-report-" + digest(identity)[:20],
        "source_collection_id": choices[0]["source_collection_id"], "source_id": choices[0]["source_id"],
        "source_count": len(sources), "sources": sources,
        "section_count": len(product["sections"]),
        "figure_count": sum(isinstance(block, dict) and block.get("kind") == "figure"
                            for _, blocks in product["sections"] for block in blocks),
        "output": str(output), "files": files,
    }
    atomic_json(output / "operation.json", result)
print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
