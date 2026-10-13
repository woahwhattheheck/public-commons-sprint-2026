#!/usr/bin/env python3
"""Register reported load and volume accounting in a current Workspace."""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    sys.path.insert(0, str(root))
    from model.workspace import Workspace
    ws = Workspace(args.workspace, create=args.create_workspace)
    collection = ws.import_sources(str(root / "point_source_load_volume.sources.json"))
    result = {
        "workspace": str(ws.root),
        "source_collection_id": collection["id"],
        "source_entries": len(collection["entries"]),
        "source_bindings": {
            entry["id"]: {"source_collection_id": collection["id"], "source_id": entry["id"]}
            for entry in collection["entries"]
        },
        "report": str(root / "source/point_source_drivers/20261013/report.html"),
        "measurement_support": "point_source_discharge",
    }
    output = Path(args.output).resolve() if args.output else root / "source/point_source_drivers/20261013/receiving/native-import.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    print(serialized, end="")

if __name__ == "__main__":
    main()
