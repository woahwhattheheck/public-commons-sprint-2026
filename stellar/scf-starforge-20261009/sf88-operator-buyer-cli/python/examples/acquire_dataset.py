#!/usr/bin/env python3
"""Use one native dataset session from initialization through application rows."""
import argparse
import json
import sys

from stellar_forge_buyer.datasets import DatasetAcquisition, DatasetError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--session", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("init", help="offline; session must be new")
    source = create.add_mutually_exclusive_group(required=True)
    source.add_argument("--config")
    source.add_argument("--workspace")
    create.add_argument("--max-pages", type=int, required=True)
    create.add_argument("--max-total-atomic", required=True)
    create.add_argument("--snapshot")
    for command in ("status", "run", "recover"):
        commands.add_parser(command)
    for command in ("deliver", "consume"):
        action = commands.add_parser(command)
        action.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "init":
        acquisition = DatasetAcquisition.create(
            checkout=args.checkout, session=args.session, config=args.config, workspace=args.workspace,
            max_pages=args.max_pages, max_total_atomic=args.max_total_atomic, snapshot=args.snapshot,
        )
        report = acquisition.last_report
    else:
        acquisition = DatasetAcquisition(checkout=args.checkout, session=args.session)
        if args.command in {"deliver", "consume"}:
            delivery = acquisition.deliver(args.out)
            if args.command == "consume":
                for row in delivery.jsonl_rows():
                    # Replace this output with the application's row consumer.
                    print(json.dumps(row, ensure_ascii=False, allow_nan=False))
                return 0
            report = delivery.native
        else:
            report = getattr(acquisition, "inspect" if args.command == "status" else args.command)()
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DatasetError as error:
        print(json.dumps({"error":error.code, "native":error.native,
                          "session":str(error.operation.directory)}), file=sys.stderr)
        raise SystemExit(1)
