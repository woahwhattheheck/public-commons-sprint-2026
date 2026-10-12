"""MIT. Open the source-monitoring workflow in the original NDJSON workspace."""
from __future__ import annotations
import argparse
import io
import json
from pathlib import Path
import signal
import sys
import threading

from model import Workspace, InputError, json_bytes
from web import OperatorServer
import matching
import updates

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, help="Original private NDJSON workspace")
    p.add_argument("--create", action="store_true", help="Create the original workspace once")
    sub = p.add_subparsers(dest="action", required=True)
    server = sub.add_parser("serve"); server.add_argument("--port", type=int, default=0)
    sub.add_parser("state")
    source = sub.add_parser("receive-published"); source.add_argument("--metadata-url", required=True)
    edition = sub.add_parser("receive-edition")
    edition.add_argument("--metadata", required=True); edition.add_argument("--entities", required=True)
    edition.add_argument("--metadata-url", required=True)
    compare = sub.add_parser("compare"); compare.add_argument("--before", required=True); compare.add_argument("--after", required=True)
    change = sub.add_parser("receive-update"); change.add_argument("--before", required=True); change.add_argument("--after", required=True)
    export = sub.add_parser("export"); export.add_argument("--output", required=True)
    receive = sub.add_parser("import"); receive.add_argument("--input", required=True)
    args = p.parse_args()
    with Workspace(args.workspace, create=args.create) as ws:
        d = ws.opensanctions
        if args.action == "serve":
            app = OperatorServer(ws, args.port)
            stop = lambda *_: threading.Thread(target=app.shutdown, daemon=True).start()
            for sig in (signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, stop)
            print(json.dumps({"url": app.url, "workspace": str(ws.root), "schema": "starforge.opensanctions-console.v1"}), flush=True)
            try:
                app.serve_forever(poll_interval=0.2)
            finally:
                app.server_close()
            return
        matching.recover_interrupted(d)
        if args.action == "state":
            result = d.state()
        elif args.action == "receive-published":
            result = updates.receive_published(d, args.metadata_url)
        elif args.action == "receive-edition":
            with Path(args.metadata).open("rb") as meta, Path(args.entities).open("rb") as entities:
                result = d.accept_edition(meta, entities, metadata_url=args.metadata_url)
        elif args.action == "compare":
            result = d.compare(args.before, args.after)
        elif args.action == "receive-update":
            result = updates.fetch_update(d, args.before, args.after)
        elif args.action == "export":
            result = d.export_packet(Path(args.output))
        else:
            result = d.import_packet(Path(args.input))
        sys.stdout.buffer.write(json_bytes(result))

if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
