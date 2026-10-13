"""Import the prepared point-source scientific report into the original Workspace.

The source-only default retains the complete report edition. An explicitly
supplied delivery selection can append this source to its ordered studies.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import sys

SOURCE_ID = "eighteenmile-point-source-scientific-report"
MANIFEST = "point_source_scientific.sources.json"
SCHEMA = "upstate.point-source-report-import/v1"


def import_report(workspace, project_root, *, selection=None):
    from model import observed_context
    from model.common import file_digest, read_json

    root = Path(project_root).resolve(strict=True)
    manifest_path = root / MANIFEST
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Choose the original prepared point-source report manifest")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ValueError("The prepared report manifest must list its original entries")
    matches = [entry for entry in entries if entry.get("id") == SOURCE_ID]
    if len(matches) != 1:
        raise ValueError("The prepared manifest must identify one point-source report")
    entry = matches[0]
    if (entry.get("kind") != "document"
            or entry.get("metadata", {}).get("report_schema") != observed_context.SCHEMA):
        raise ValueError("The original report must declare its observed-report schema")

    # Reject an invalid prior selection before importing a new immutable edition.
    joined = None
    if selection is not None:
        if not isinstance(selection, dict):
            raise ValueError("Supply the existing delivery selection object")
        joined = copy.deepcopy(selection)
        choices = observed_context.source_choices(joined)
        observed_context.bind(workspace, joined)
    else:
        choices = []

    manifest_sha256 = file_digest(manifest_path)
    collection = workspace.import_sources(manifest_path)
    if collection["original_manifest"]["sha256"] != manifest_sha256:
        raise ValueError("The prepared report manifest changed during import")
    source = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
    # The maintained binder resolves Workspace.source_file and verifies every
    # original recipe input and companion through the retained source view.
    source_binding = observed_context.bind(
        workspace, {"observed_context_sources": [source]})
    result = {
        "schema": SCHEMA,
        "project_id": workspace.project["id"],
        "source": source,
        "source_binding": source_binding,
        "manifest_sha256": manifest_sha256,
        "source_collection_id": collection["id"],
        "imported_entries": len(collection["entries"]),
        "source_report_view": "sources",
    }
    if joined is not None:
        if source not in choices:
            choices.append(dict(source))
        joined["observed_context_sources"] = choices
        joined.setdefault("source_roles", {})[observed_context.ROLE] = dict(choices[0])
        joined.pop("observed_context_binding", None)
        joined["observed_context_binding"] = observed_context.bind(workspace, joined)
        result["observed_context_binding"] = joined["observed_context_binding"]
        result["delivery_selection"] = joined
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", help="Existing delivery selection JSON object")
    parser.add_argument("--selection-output", help="Save the joined delivery selection")
    parser.add_argument("--output", help="Save the actual import and binding receipt")
    args = parser.parse_args(argv)
    if args.selection_output and not args.selection:
        parser.error("--selection-output requires the existing --selection")
    root = Path(args.project_root).resolve(strict=True)
    sys.path.insert(0, str(root))
    from model.common import atomic_json, read_json
    from model.workspace import Workspace

    selection_path = Path(args.selection).resolve(strict=True) if args.selection else None
    output_paths = [Path(value).resolve() for value in
                    (args.output, args.selection_output) if value]
    if len(set(output_paths)) != len(output_paths):
        parser.error("Use separate paths for the receipt and joined selection")
    manifest_path = (root / MANIFEST).resolve(strict=True)
    manifest = read_json(manifest_path)
    original_paths = {manifest_path}
    if selection_path:
        original_paths.add(selection_path)
    for entry in manifest.get("entries", []):
        for item in [entry, *entry.get("companions", [])]:
            original_paths.add((root / item["path"]).resolve())
    if any(path in original_paths for path in output_paths):
        parser.error("Save outputs separately from the original sources and input selection")

    result = import_report(
        Workspace(Path(args.workspace).resolve(strict=True)), root,
        selection=read_json(selection_path) if selection_path else None)
    if args.selection_output:
        atomic_json(Path(args.selection_output), result["delivery_selection"])
    if args.output:
        atomic_json(Path(args.output), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
