#!/usr/bin/env python3
"""Launch the private Commons BI operator or execute its structured native actions."""
import argparse
import getpass
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def main():
    parser = argparse.ArgumentParser(description="Commons BI migration and support workspace")
    parser.add_argument("--workspace", default="./bi-workspace", help="Local, private workspace directory")
    commands = parser.add_subparsers(dest="command", required=True)
    server = commands.add_parser("serve", help="Open the industrial operator UI on localhost")
    server.add_argument("--port", type=int, default=0)
    action = commands.add_parser("action", help="Run a native workspace action with a JSON file")
    action.add_argument("name")
    action.add_argument("request", help="JSON request file, or - for stdin; use a stable operation_id for replay")
    commands.add_parser("state", help="Read current migration and support state")
    recover = commands.add_parser("restore", help="Authenticate and restore an encrypted workspace to a new path")
    recover.add_argument("backup")
    recover.add_argument("destination")
    backup = commands.add_parser("backup", help="Write an encrypted workspace backup")
    backup.add_argument("destination")
    example = commands.add_parser("example", help="Import the complete published SANDAG aggregate example")
    example.add_argument("--build", action="store_true", help="Build its complete native Power BI project")
    args = parser.parse_args()
    if args.command == "serve":
        from bi_operator.host import serve
        serve(args.workspace, args.port)
        return
    if args.command == "restore":
        from bi_operator.archive import restore
        result = restore(args.backup, args.destination, getpass.getpass("Backup passphrase: "))
    else:
        from bi_operator.host import WorkspaceLease
        from bi_operator.service import Service
        with WorkspaceLease(args.workspace):
            service = Service(args.workspace)
            try:
                if args.command == "action":
                    request = json.load(sys.stdin) if args.request == "-" else json.loads(Path(args.request).read_text(encoding="utf-8"))
                    result = service.dispatch(args.name, request)
                elif args.command == "state":
                    result = service.state()
                elif args.command == "backup":
                    from bi_operator.archive import backup
                    result = backup(service.store, args.destination, getpass.getpass("Backup passphrase: "))
                elif args.command == "example":
                    from bi_operator.example import load_example
                    result = load_example(service, build=args.build)
            finally:
                service.close()
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
