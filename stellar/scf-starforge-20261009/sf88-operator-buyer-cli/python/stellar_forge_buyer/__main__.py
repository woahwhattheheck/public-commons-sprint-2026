"""Private local buyer CLI. Execution delegates to SF88's terminal approval."""
import argparse
import json
import os
import sys

from .client import Buyer
from .errors import BuyerError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", default=os.environ.get("STELLAR_FORGE_CHECKOUT"), required=not os.environ.get("STELLAR_FORGE_CHECKOUT"))
    parser.add_argument("--state", required=True)
    parser.add_argument("--node", default="node")
    commands = parser.add_subparsers(dest="command", required=True)
    imported = commands.add_parser("import", help="snapshot an existing original SF88 config")
    imported.add_argument("config")
    prepared = commands.add_parser("prepare", help="select one original saved catalog offer")
    prepared.add_argument("discovery")
    prepared.add_argument("--row", type=int, required=True)
    prepared.add_argument("--accept", type=int, required=True)
    prepared.add_argument("--intent", required=True)
    prepared.add_argument("--url", required=True)
    prepared.add_argument("--method", default="GET")
    configured = commands.add_parser("configure")
    configured.add_argument("intent")
    configured.add_argument("profile")
    for name in ("review", "execute", "recover", "inspect"):
        command = commands.add_parser(name)
        command.add_argument("intent")
    commands.add_parser("list")
    args = parser.parse_args()
    try:
        buyer = Buyer(checkout=args.checkout, state_dir=args.state, node=args.node)
        if args.command == "import":
            output = buyer.from_config(args.config).inspect()
        elif args.command == "prepare":
            output = buyer.prepare(args.discovery, row=args.row, accept=args.accept,
                intent_id=args.intent, url=args.url, method=args.method).inspect()
        elif args.command == "list":
            output = [op.inspect() for op in buyer.list_operations()]
        else:
            op = buyer.operation(args.intent)
            if args.command == "configure":
                output = op.configure(args.profile).inspect()
            elif args.command == "review":
                reviewed = op.review()
                output = {"configSha256": reviewed.config_sha256, "native": reviewed.native}
            elif args.command == "execute":
                reviewed = op.review()
                print(json.dumps({"review": reviewed.native}, indent=2), file=sys.stderr)
                result = op.execute(review=reviewed)
                print(json.dumps(result.record, indent=2))
                return 0 if result.ok else 2
            elif args.command == "recover":
                result = op.recover()
                output = result.record if result else op.inspect()
            else:
                output = op.inspect()
        print(json.dumps(output, indent=2))
        return 0
    except BuyerError as error:
        print(json.dumps({"error": error.code, "operationDirectory":
            str(error.operation.directory) if error.operation else None}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
