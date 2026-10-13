#!/usr/bin/env python3
"""Open the retained NC designation/assessment report in an existing Workspace."""
import argparse
import json
import sys
from pathlib import Path

APPLICATION = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(APPLICATION))
from model.workspace import Workspace
from model import scientific_report_editions

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    workspace_path = args.workspace.expanduser().resolve(strict=True)
    ws = Workspace(workspace_path)
    collection = ws.import_sources(APPLICATION / "nc_designation_assessment.sources.json")
    payload = {
        "sources": [{
            "source_collection_id": collection["id"],
            "source_id": "nc-designation-assessment-observed-report"
        }],
        "title": "NC designated waters: published 2022 assessment context"
    }
    preview = scientific_report_editions.preview(ws, payload)
    result = scientific_report_editions.render(ws, {**payload, "preview_id": preview["id"]})
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    record = {
        "schema": "upstate.nc-designation-assessment-opening/v1",
        "workspace": str(workspace_path),
        "source_collection_id": collection["id"],
        "preview_id": preview["id"],
        "result": result,
        "open_in_operator": "Sources > Scientific report > Saved reports",
        "outgoing_review": "Open this exact saved edition, inspect desktop and narrow pixels, exercise downloads and reopen the exported study."
    }
    (output / "nc-designation-assessment-opening.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2))

if __name__ == "__main__":
    main()
