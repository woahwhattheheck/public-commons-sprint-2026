#!/usr/bin/env python3
"""MIT. Native XML dataset operator; no packages or remote services required."""
from __future__ import annotations
import argparse
import json
import signal
from pathlib import Path
import sys

from workspace import Workspace, InputError, load_json
from server import OperatorServer


def main(argv=None):
    parser = argparse.ArgumentParser(description="Retain XML editions, review explicit mappings, and export original SF30 datasets")
    parser.add_argument("--workspace", required=True, help="Private local workspace directory")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Create a new private workspace")
    sub.add_parser("list", help="List retained source editions, mappings, builds and comparisons")
    intake = sub.add_parser("source", help="Retain and fully inventory an XML file")
    intake.add_argument("--file", required=True)
    intake.add_argument("--label", default="XML source")
    inspect = sub.add_parser("inspect", help="Inspect the full retained XML shape")
    inspect.add_argument("--source", required=True)
    plan = sub.add_parser("plan", help="Save an immutable explicit mapping")
    plan.add_argument("--file", required=True)
    build = sub.add_parser("build", help="Project every record and validate through the original SF30 engine")
    build.add_argument("--source", required=True); build.add_argument("--plan", required=True)
    query = sub.add_parser("query", help="Query a completed build through original native admission/handler")
    query.add_argument("--build", required=True)
    query.add_argument("--params", default="{}", help="JSON object of native scalar-string query parameters")
    compare = sub.add_parser("compare", help="Compare complete keyed editions, retaining all changes")
    compare.add_argument("--before", required=True); compare.add_argument("--after", required=True)
    changes = sub.add_parser("changes", help="Read a page of retained field changes")
    changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=int, default=0); changes.add_argument("--limit", type=int, default=50)
    export = sub.add_parser("export", help="Create a portable project ZIP, INCLUDING the original XML")
    export.add_argument("--build", required=True); export.add_argument("--out", required=True)
    publish = sub.add_parser("dataset", help="Export only original CSV/config/lineage to a new directory")
    publish.add_argument("--build", required=True); publish.add_argument("--out", required=True)
    receive = sub.add_parser("import", help="Verify and reconstruct a portable project in this workspace")
    receive.add_argument("--file", required=True)
    serve = sub.add_parser("serve", help="Open the loopback-only industrial operator console")
    serve.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    with Workspace(args.workspace, create=args.command == "init") as ws:
        c = args.command
        if c in {"init", "list"}:
            result = ws.state()
        elif c == "source":
            with Path(args.file).open("rb") as stream:
                result = ws.add_source(stream, args.label, Path(args.file).name)
        elif c == "inspect":
            result = ws.source(args.source)
        elif c == "plan":
            result = ws.save_plan(load_json(Path(args.file).read_bytes()))
        elif c == "build":
            result = ws.build(args.source, args.plan)
        elif c == "query":
            result = ws.query(args.build, load_json(args.params))
        elif c == "compare":
            result = ws.compare(args.before, args.after)
        elif c == "changes":
            result = ws.comparison_page(args.comparison, args.offset, args.limit)
        elif c == "export":
            result = ws.export_packet(args.build, Path(args.out).absolute())
        elif c == "dataset":
            result = ws.export_dataset(args.build, args.out)
        elif c == "import":
            result = ws.import_packet(Path(args.file))
        elif c == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be from 0 to 65535")
            server = OperatorServer(ws, args.port)
            print(json.dumps({"console": server.url, "workspace": str(ws.root)}), flush=True)
            def terminate(_signal, _frame):
                raise KeyboardInterrupt
            previous = signal.signal(signal.SIGTERM, terminate)
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
            finally:
                # A second stop must not interrupt draining original HTTP/native work.
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                signal.signal(signal.SIGINT, signal.SIG_IGN)
                try:
                    server.server_close()
                finally:
                    signal.signal(signal.SIGTERM, previous)
            return
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError) as error:
        print(f"XML dataset: {error}", file=sys.stderr)
        sys.exit(1)
