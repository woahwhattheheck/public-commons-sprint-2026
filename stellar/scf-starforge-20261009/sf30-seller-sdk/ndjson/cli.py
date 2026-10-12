#!/usr/bin/env python3
"""MIT. Complete retained NDJSON source, merchant and customer handoff."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import json
import os
import stat
import tempfile
from pathlib import Path
import signal
import sys

from application import Workspace, OperatorServer, InputError, load_json


@contextmanager
def published_connection(filename, url):
    """Atomically publish one private connection, without replacing an existing file."""
    if filename is None:
        yield None
        return
    destination = Path(filename).expanduser().absolute()
    encoded = (url + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError as error:
            raise InputError("Connection file already exists; use its running console, or remove a stale file after its process stops") from error
    finally:
        temporary.unlink(missing_ok=True)
    try:
        yield str(destination)
    finally:
        try:
            info = destination.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_size == len(encoded) and destination.read_bytes() == encoded:
                destination.unlink()
        except FileNotFoundError:
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="Retain JSON Lines exports, review exact fields, and operate original SF30 datasets")
    parser.add_argument("--workspace", required=True, help="Private local workspace directory")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    sub.add_parser("list")
    source = sub.add_parser("source", help="Retain and inventory every NDJSON record")
    source.add_argument("--file", required=True)
    source.add_argument("--label", default="NDJSON source")
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--source", required=True)
    plan = sub.add_parser("plan", help="Save an explicit immutable field mapping")
    plan.add_argument("--file", required=True)
    build = sub.add_parser("build", help="Project the complete source through the original dataset engine")
    build.add_argument("--source", required=True)
    build.add_argument("--plan", required=True)
    query = sub.add_parser("query")
    query.add_argument("--build", required=True)
    query.add_argument("--params", default="{}", help="JSON object of native scalar-string query parameters")
    compare = sub.add_parser("compare")
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    changes = sub.add_parser("changes")
    changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=int, default=0)
    changes.add_argument("--limit", type=int, default=50)
    for command in ["export", "dataset"]:
        target = sub.add_parser(command, help="Export the complete project ZIP" if command == "export" else "Export original CSV/config/lineage")
        target.add_argument("--build", required=True)
        target.add_argument("--out", required=True)
    receive = sub.add_parser("import", help="Reconstruct the original source, mapping and native dataset")
    receive.add_argument("--file", required=True)
    merchant = sub.add_parser("merchant", help="Prepare a complete native merchant and generated customer SDK")
    merchant.add_argument("--build", required=True)
    merchant.add_argument("--payment", required=True)
    merchant.add_argument("--origin", required=True)
    merchant.add_argument("--path", default="/data")
    merchant.add_argument("--out", required=True)
    serve = sub.add_parser("serve", help="Open the private industrial source console")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--connection-file", help="Atomically create a private one-line console URL for the merchant MCP")
    args = parser.parse_args(argv)
    with Workspace(args.workspace, create=args.command == "init") as ws:
        c = args.command
        if c in {"init", "list"}:
            result = ws.state()
        elif c == "source":
            with Path(args.file).open("rb") as source:
                result = ws.add_source(source, args.label, Path(args.file).name)
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
        elif c == "merchant":
            result = ws.prepare_merchant(args.build, load_json(Path(args.payment).read_bytes()),
                                         args.origin, args.path, args.out)
        elif c == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be from 0 to 65535")
            server = OperatorServer(ws, args.port)
            def terminate(_signal, _frame):
                raise KeyboardInterrupt
            previous = signal.signal(signal.SIGTERM, terminate)
            try:
                with published_connection(args.connection_file, server.url) as connection:
                    print(json.dumps({"console": server.url, "workspace": str(ws.root),
                                      **({"connectionFile": connection} if connection else {})}), flush=True)
                    server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
            finally:
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
        print(f"NDJSON dataset: {error}", file=sys.stderr)
        sys.exit(1)
