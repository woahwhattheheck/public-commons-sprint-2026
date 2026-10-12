#!/usr/bin/env python3
"""Operate retained SDMX sources and editions through their original workspace."""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
from pathlib import Path
import signal
import sys
import threading

from sdmx_workspace import Workspace, load_json


def integer(value):
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("use a nonnegative integer")
    if str(result) != value or result < 0:
        raise argparse.ArgumentTypeError("use a nonnegative integer")
    return result


def positive(value):
    result = integer(value)
    if result < 1:
        raise argparse.ArgumentTypeError("use a positive integer")
    return result


def json_file(path):
    with open(path, "rb") as stream:
        raw = stream.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("The operator JSON file exceeds 8 MiB")
    return load_json(raw)


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)


def parser():
    result = argparse.ArgumentParser(
        description="Retain official SDMX sources, save complete editions, query the original dataset and receive portable projects.",
        epilog="Merchant and customer commands: dataset sdmx merchant --help; dataset sdmx buyer --help.")
    result.add_argument("--workspace", required=True, help="original private SDMX workspace directory")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="create the original workspace")
    commands.add_parser("state", aliases=["list"], help="show current retained source and project summaries")
    serve = commands.add_parser("serve", help="open the original private browser workspace")
    serve.add_argument("--port", type=integer, default=0)
    source = commands.add_parser("source", help="retain an exact original source file and its acquisition metadata")
    source.add_argument("--file", required=True, help="original file path, or - for binary standard input")
    source.add_argument("--name", help="retained filename; defaults to the input filename")
    source.add_argument("--label", default="")
    source.add_argument("--origin", default="", help="actual original source URL")
    source.add_argument("--kind", choices=("auto", "data", "catalog", "structure"), default="auto")
    source.add_argument("--media-type")
    source.add_argument("--coverage", help="JSON file containing the original acquisition coverage")
    source.add_argument("--receipt", help="JSON file containing the exact original acquisition receipt")
    detail = commands.add_parser("source-show", help="show retained source structure and coverage")
    detail.add_argument("--source", required=True)
    series = commands.add_parser("series", help="page the complete selected source's native series inventory")
    series.add_argument("--source", required=True)
    series.add_argument("--query", default="")
    series.add_argument("--offset", type=integer, default=0)
    series.add_argument("--limit", type=positive, default=50)
    observations = commands.add_parser("observations", help="page exact original observation values")
    observations.add_argument("--source", required=True)
    observations.add_argument("--series-key")
    observations.add_argument("--offset", type=integer, default=0)
    observations.add_argument("--limit", type=positive, default=50)
    project = commands.add_parser("project", help="save the explicit project selection and build its original dataset")
    project.add_argument("--file", required=True, help="project JSON with stable operation_id and expected_revision for updates")
    view = commands.add_parser("project-show", help="inspect a current or retained project revision")
    view.add_argument("--project", required=True)
    view.add_argument("--revision", type=positive)
    query = commands.add_parser("query", help="run the original immutable SF30 query engine")
    query.add_argument("--project", required=True)
    query.add_argument("--revision", type=positive)
    query.add_argument("--params", default="{}", help="JSON object containing original scalar string query parameters")
    compare = commands.add_parser("compare", help="compare retained editions through the original source-aware comparison")
    compare.add_argument("--before-project", required=True)
    compare.add_argument("--after-project", required=True)
    compare.add_argument("--before-revision", type=positive)
    compare.add_argument("--after-revision", type=positive)
    changes = commands.add_parser("changes", help="page a saved original edition comparison")
    changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=integer, default=0)
    changes.add_argument("--limit", type=positive, default=50)
    for command, description in (
        ("dataset", "export data.csv, dataset.json and exact SDMX lineage"),
        ("export", "export the complete portable source and project packet"),
    ):
        operation = commands.add_parser(command, help=description)
        operation.add_argument("--project", required=True)
        operation.add_argument("--revision", type=positive)
        operation.add_argument("--out", required=True)
    receive = commands.add_parser("import", help="receive and reconstruct an original portable SDMX project")
    receive.add_argument("--file", required=True)
    return result


def serve_workspace(workspace, port, directory):
    from sdmx_server import OperatorServer
    server = OperatorServer(workspace, port)
    previous = {}
    stopping = False
    shutdown = None

    def stop(_signal, _frame):
        nonlocal stopping, shutdown
        if stopping:
            return
        stopping = True
        # ThreadingHTTPServer.shutdown must not run inside serve_forever's
        # own thread. The original server drains its accepted request threads.
        shutdown = threading.Thread(target=server.shutdown, name="sdmx-cli-shutdown", daemon=True)
        shutdown.start()

    try:
        for name in ("SIGINT", "SIGTERM"):
            selected = getattr(signal, name, None)
            if selected is not None:
                previous[selected] = signal.signal(selected, stop)
        print_json({"url": server.url, "origin": server.origin, "workspace": str(Path(directory).resolve())})
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        if shutdown is not None:
            shutdown.join()
        for selected, handler in previous.items():
            signal.signal(selected, handler)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        with Workspace(args.workspace, create=args.command == "init") as workspace:
            action = args.command
            if action == "serve":
                serve_workspace(workspace, args.port, args.workspace)
                return 0
            if action in ("init", "state", "list"):
                value = workspace.state()
            elif action == "source":
                name = args.name or (Path(args.file).name if args.file != "-" else "stdin.xml")
                metadata = {"name": name, "label": args.label or name, "origin": args.origin, "kind": args.kind}
                if args.media_type is not None:
                    metadata["media_type"] = args.media_type
                if args.coverage is not None:
                    metadata["coverage"] = json_file(args.coverage)
                if args.receipt is not None:
                    metadata["receipt"] = json_file(args.receipt)
                selected = nullcontext(sys.stdin.buffer) if args.file == "-" else open(args.file, "rb")
                with selected as stream:
                    value = workspace.add_source(stream, metadata)
            elif action == "source-show":
                value = workspace.source(args.source)
            elif action == "series":
                value = workspace.series(args.source, offset=args.offset, limit=args.limit, query=args.query)
            elif action == "observations":
                value = workspace.observations(args.source, series_key=args.series_key,
                                               offset=args.offset, limit=args.limit)
            elif action == "project":
                value = workspace.save_project(json_file(args.file))
            elif action == "project-show":
                value = workspace.project(args.project, revision=args.revision)
            elif action == "query":
                if len(args.params) > 65536:
                    raise ValueError("Native query parameters exceed 64 KiB")
                params = load_json(args.params)
                if not isinstance(params, dict) or any(not isinstance(item, str) for item in params.values()):
                    raise ValueError("Native query parameters must be a JSON object of scalar strings")
                value = workspace.query(args.project, params, revision=args.revision)
            elif action == "compare":
                value = workspace.compare(args.before_project, args.after_project,
                    before_revision=args.before_revision, after_revision=args.after_revision)
            elif action == "changes":
                value = workspace.comparison_page(args.comparison, offset=args.offset, limit=args.limit)
            elif action == "dataset":
                value = workspace.export_dataset(args.project, args.out, revision=args.revision)
            elif action == "export":
                value = workspace.export_packet(args.project, args.out, revision=args.revision)
            elif action == "import":
                value = workspace.import_packet(args.file)
            else:
                raise ValueError("Choose an original SDMX command")
            print_json(value)
        return 0
    except (OSError, ValueError, TypeError, KeyError, RuntimeError) as error:
        code = getattr(error, "code", None) or "SDMX_OPERATION_FAILED"
        print(json.dumps({"error": code, "message": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
