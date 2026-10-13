#!/usr/bin/env python3
"""Operate the original GWMA study workspace from complete JSON requests."""
import argparse
import base64
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model.workspace import Workspace
from model import gwma_study

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--title", default="GWMA regional pathogen study")
    parser.add_argument("--request", help="UTF-8 JSON action payload")
    parser.add_argument("--csv", help="Original CSV for the intake action")
    parser.add_argument("--kind", choices=list(gwma_study.KINDS))
    parser.add_argument("--id")
    parser.add_argument("action", choices=("study", "mapping", "intake", "review", "contract",
                                          "plan", "handover", "catalog", "item", "rows", "verify"))
    args = parser.parse_args()
    workspace = Workspace(args.workspace, create=args.create, title=args.title)
    payload = json.loads(Path(args.request).read_text(encoding="utf-8")) if args.request else {}
    if args.csv:
        if args.action != "intake":
            parser.error("--csv belongs to the original intake action")
        path = Path(args.csv)
        if path.stat().st_size > gwma_study.MAX_UPLOAD:
            parser.error("For originals over 4 MiB use an existing registered source or observation_id")
        payload["csv_base64"] = base64.b64encode(path.read_bytes()).decode("ascii")
        payload["filename"] = path.name
    operations = {"study": gwma_study.save_study, "mapping": gwma_study.save_mapping,
                  "intake": gwma_study.intake, "review": gwma_study.save_review,
                  "contract": gwma_study.save_contract, "plan": gwma_study.save_plan,
                  "handover": gwma_study.build_handover, "rows": gwma_study.rows}
    if args.action in operations:
        result = operations[args.action](workspace, payload)
    elif args.action == "catalog":
        result = gwma_study.catalog(workspace)
    elif args.action == "verify":
        result = gwma_study.verify_all(workspace)
    else:
        if not args.kind or not args.id:
            parser.error("item requires --kind and --id")
        result = gwma_study.item(workspace, args.kind, args.id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))

if __name__ == "__main__":
    main()
