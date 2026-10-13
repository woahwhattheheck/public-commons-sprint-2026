#!/usr/bin/env python3
"""Operate one exact discovery edition. No network or external dependencies."""
import argparse
import json
from pathlib import Path
import sys
from discovery_engine import (DiscoveryError, compare_reports, create_handover,
    read_json, receive_handover, run_manifest, write_json)

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Profile complete original CSV files and calculate the declared cohorts")
    run.add_argument("--manifest", required=True)
    run.add_argument("--output", required=True)
    run.add_argument("--input-root", help="Authorized root; defaults to the manifest's directory")
    run.add_argument("--max-field-chars", type=int, default=16*1024*1024)
    compare = commands.add_parser("compare", help="Compare complete saved reports with both denominators")
    compare.add_argument("--left", required=True)
    compare.add_argument("--right", required=True)
    compare.add_argument("--output", required=True)
    pack = commands.add_parser("pack", help="Preserve a complete private source-and-data handover")
    pack.add_argument("--run", required=True)
    pack.add_argument("--output", required=True)
    receive = commands.add_parser("receive", help="Verify every original file before receiving a handover")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--output", required=True)
    receive.add_argument("--max-expanded-bytes", type=int, default=4*1024**3)
    args = p.parse_args(argv)
    try:
        if args.command == "run":
            if args.max_field_chars < 1024:
                raise DiscoveryError("Maximum CSV field size must be at least 1024 characters")
            completed = run_manifest(args.manifest, args.output, root=args.input_root, max_field_chars=args.max_field_chars)
            report = completed["report"]
            result = {"output": completed["output"], "run_identity": report["run_identity"],
                      "data_class": report["data_class"], "quality_status": report["quality_status"],
                      "tables": [{"id": t["id"], "rows": t["rows"], "invalid_rows": t["invalid_rows"]} for t in report["tables"]],
                      "metrics": [{"id": m["id"], "status": m["status"], "denominator": m["denominator"]} for m in report["metrics"]]}
        elif args.command == "compare":
            output = Path(args.output)
            if output.exists():
                raise DiscoveryError("Choose a new comparison filename")
            result = compare_reports(read_json(args.left), read_json(args.right), Path(args.left).resolve().parent, Path(args.right).resolve().parent)
            output.parent.mkdir(parents=True, exist_ok=True)
            write_json(output, result)
            result = {"output": str(output.resolve()), "metrics": [
                {"id": row["metric"], "comparison": row["comparison"], "denominator_change": row.get("denominator_change")}
                for row in result["metrics"]]}
        elif args.command == "pack":
            root = Path(__file__).resolve().parent
            files = [root / name for name in ("discovery_engine.py", "discovery_cli.py", "README.md", "OPERATOR_GUIDE.md")
                     if (root / name).is_file()]
            result = create_handover(args.run, args.output, files)
        else:
            if args.max_expanded_bytes < 1:
                raise DiscoveryError("Expanded-byte limit must be positive")
            result = receive_handover(args.archive, args.output, args.max_expanded_bytes)
        print(json.dumps({"status": "COMPLETE", **result}, ensure_ascii=False, sort_keys=True))
        return 0
    except (DiscoveryError, ValueError, OSError) as error:
        print(json.dumps({"status": "ERROR", "type": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
