#!/usr/bin/env python3
"""Import a complete seasonal-trend edition and render it through the existing Workspace."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys


def import_study(application: Path, workspace: Path, source: Path, output: Path) -> dict:
    application = application.resolve(strict=True)
    source = source.resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model import observed_report_render
    from model.common import atomic_json

    inventory = json.loads((source / "file-manifest.json").read_text(encoding="utf-8"))
    for item in inventory["files"]:
        path = (source / item["path"]).resolve(strict=True)
        if not path.is_relative_to(source) or not path.is_file():
            raise ValueError("Source member escapes the selected study")
        data = path.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Source member changed: " + item["path"])
    ws = Workspace(workspace)
    manifest = source / "sources.json"
    receipt_path = output / "native-import.json"
    # Reuse an already published source collection for this exact import.
    if receipt_path.exists():
        previous = json.loads(receipt_path.read_text(encoding="utf-8"))
        if (previous.get("source_edition_sha256") != inventory["source_edition_sha256"]
                or previous.get("manifest_sha256") != hashlib.sha256(manifest.read_bytes()).hexdigest()
                or previous.get("project_id") != ws.project["id"]):
            raise ValueError("Choose a new native output for another source edition or project")
        choice = previous["observed_context_source"]
        ws.source_file(choice["source_collection_id"], choice["source_id"])
    else:
        collection = ws.import_sources(manifest)
        reports = [x for x in collection["entries"] if x.get("role") == "OBSERVED_CONTEXT"]
        if len(reports) != 1:
            raise ValueError("Select one complete seasonal observed-report source")
        choice = {"source_collection_id": collection["id"], "source_id": reports[0]["id"]}
        output.mkdir(parents=True, exist_ok=True)
        atomic_json(receipt_path, {
            "schema": "upstate.seasonal-trend-import/v1", "project_id": ws.project["id"],
            "source_edition_sha256": inventory["source_edition_sha256"],
            "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
            "observed_context_source": choice,
        }, immutable=True)
    preview = observed_report_render.prepare(ws, [choice], manifest_paths=[manifest])
    result = observed_report_render.render(ws, preview, output / "scientific-report")
    receipt = {"schema": "upstate.seasonal-trend-delivery/v1", "project_id": ws.project["id"],
               "source_edition_sha256": inventory["source_edition_sha256"],
               "observed_context_source": choice, "native_report": result}
    atomic_json(output / "delivery.json", receipt)
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=Path(__file__).parent)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = import_study(args.application, args.workspace, args.source, args.output.resolve())
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
