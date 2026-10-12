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
    server.add_argument("--connection-file", help="Create the original private one-line console connection")
    server.add_argument("--expected-binding", help="Require the reviewed native workspace, Python and source")
    server.add_argument("--startup-format", choices=["legacy", "json"], default="legacy")
    sub.add_parser("binding", help="Inspect native application identity without opening the workspace writer")
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
    if args.action == "binding":
        from application_binding import inspect_binding
        sys.stdout.buffer.write(json_bytes(inspect_binding(args.workspace)))
        return
    binding = None
    if args.action == "serve" and (args.expected_binding is not None or args.startup_format == "json"):
        from application_binding import require_binding
        binding = require_binding(args.workspace, args.expected_binding)
    with Workspace(args.workspace, create=args.create) as ws:
        if binding is not None:
            binding = require_binding(str(ws.root), binding["sha256"])
        d = ws.opensanctions
        if args.action == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be from 0 to 65535")
            app = OperatorServer(ws, args.port)
            stop = lambda *_: threading.Thread(target=app.shutdown, daemon=True).start()
            previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
            try:
                if binding is not None or args.connection_file:
                    from application_binding import published_connection, startup
                    connection = published_connection(args.connection_file, app.url)
                else:
                    from contextlib import nullcontext
                    connection = nullcontext(None)
                with connection as connection_file:
                    if binding is not None:
                        app.launch = startup(app, binding, connection_file)
                    announcement = app.launch if args.startup_format == "json" else {
                        "url": app.url, "workspace": str(ws.root),
                        "schema": "starforge.opensanctions-console.v1",
                        **({"connectionFile": connection_file} if connection_file else {}),
                    }
                    print(json.dumps(announcement, ensure_ascii=False, separators=(",", ":")), flush=True)
                    app.serve_forever(poll_interval=0.2)
            finally:
                app.launch = None
                app.server_close()
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
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
