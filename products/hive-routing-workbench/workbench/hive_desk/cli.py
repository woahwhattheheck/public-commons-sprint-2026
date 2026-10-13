"""Complete command-line entrypoint for the same operator and saved receiving workflow."""
import argparse
import json
from pathlib import Path
import sys
from .controller import Controller
from .server import serve
from .util import json_text
from .workspace import Workspace, receive_archive

def main(argv=None):
    parser = argparse.ArgumentParser(description="Operate and receive a complete original Hive application.")
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[1]))
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create the saved operator workspace.")
    init.add_argument("workspace")
    init.add_argument("--name", default="Hive application migration")
    web = commands.add_parser("serve", help="Open the grayscale local operator and selected GraphQL endpoint.")
    web.add_argument("workspace")
    web.add_argument("--host", default="127.0.0.1")
    web.add_argument("--port", default=8794, type=int)
    action = commands.add_parser("action", help="Execute the same native/operator action used by the browser.")
    action.add_argument("workspace")
    action.add_argument("action")
    body = action.add_mutually_exclusive_group()
    body.add_argument("--data", help="Full JSON command data.")
    body.add_argument("--data-file", help="Read exact command JSON from a file; '-' reads stdin.")
    restore = commands.add_parser("receive", help="Receive the complete source, workspace and original files into a new directory.")
    restore.add_argument("archive")
    restore.add_argument("destination")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            with Workspace(args.workspace, create=True, name=args.name) as ws:
                result = ws.summary()
        elif args.command == "serve":
            serve(args.workspace, args.source_root, args.host, args.port)
            return 0
        elif args.command == "receive":
            result = receive_archive(args.archive, args.destination)
        else:
            if args.data_file:
                raw = sys.stdin.read() if args.data_file == "-" else Path(args.data_file).read_text("utf-8")
                data = json.loads(raw)
            else:
                data = json.loads(args.data) if args.data else {}
            with Workspace(args.workspace) as ws:
                result = Controller(ws, args.source_root).call(args.action, data)
        print(json_text(result), flush=True)
        return 0
    except Exception as error:
        print(json_text({"error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
