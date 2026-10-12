#!/usr/bin/env python3
"""MIT. Native Kafka capture, original dataset edition and whole customer receiving."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import threading

from shared import InputError, load_json
from contract import api_bytes
from model import Workspace
from httpd import OperatorServer
from managed import inspect_binding, require_binding, startup, published_connection


def emit(value):
    sys.stdout.buffer.write(api_bytes(value))
    sys.stdout.buffer.flush()


def input_json(path):
    value = Path(path).expanduser().absolute()
    if value.stat().st_size > 1024 * 1024:
        raise InputError("The original Kafka request exceeds 1 MiB")
    return load_json(value.read_bytes())


def main(argv=None):
    if sys.version_info < (3, 11):
        raise InputError("The original Kafka command requires Python 3.11 or newer")
    parser = argparse.ArgumentParser(description="Capture exact Kafka ranges, retain source history and operate original SF30 datasets")
    parser.add_argument("--workspace", required=True, help="Original private Kafka workspace")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("init", "list", "binding"):
        sub.add_parser(command)
    for command in ("connection", "inspect", "capture", "project"):
        item = sub.add_parser(command)
        item.add_argument("--file", required=True, help="Exact original JSON operation request")
    run = sub.add_parser("run", help="Run or resume the same original native capture in the foreground")
    run.add_argument("--capture", required=True)
    run.add_argument("--expected-revision", required=True, type=int)
    cancel = sub.add_parser("cancel")
    cancel.add_argument("--capture", required=True)
    messages = sub.add_parser("messages")
    messages.add_argument("--capture", required=True)
    messages.add_argument("--offset", type=int, default=0)
    messages.add_argument("--limit", type=int, default=50)
    message = sub.add_parser("message")
    message.add_argument("--id", required=True)
    source = sub.add_parser("source")
    source.add_argument("--file", required=True)
    source.add_argument("--label", default="Kafka source")
    plan = sub.add_parser("plan")
    plan.add_argument("--file", required=True)
    build = sub.add_parser("build")
    build.add_argument("--source", required=True)
    build.add_argument("--plan", required=True)
    query = sub.add_parser("query")
    query.add_argument("--build", required=True)
    query.add_argument("--params", default="{}")
    compare = sub.add_parser("compare")
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    changes = sub.add_parser("changes")
    changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=int, default=0)
    changes.add_argument("--limit", type=int, default=50)
    for command in ("export", "dataset", "native-export"):
        item = sub.add_parser(command)
        item.add_argument("--build", required=True)
        item.add_argument("--out", required=True)
        if command == "export":
            item.add_argument("--projection", help="Exact Kafka history when multiple projections share the same original source")
    for command in ("import", "native-import"):
        item = sub.add_parser(command)
        item.add_argument("--file", required=True)
    merchant = sub.add_parser("merchant")
    merchant.add_argument("--build", required=True)
    merchant.add_argument("--payment", required=True)
    merchant.add_argument("--origin", required=True)
    merchant.add_argument("--path", default="/data")
    merchant.add_argument("--out", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--connection-file")
    serve.add_argument("--expected-binding")
    serve.add_argument("--startup-format", choices=("legacy", "json"), default="legacy")
    args = parser.parse_args(argv)
    if args.command == "binding":
        emit(inspect_binding(args.workspace))
        return 0
    binding = require_binding(args.workspace, args.expected_binding) if args.command == "serve" else None
    with Workspace(args.workspace, create=args.command == "init") as ws:
        if binding is not None:
            binding = require_binding(str(ws.root), binding["sha256"])
        command = args.command
        if command in {"init", "list"}:
            result = ws.state()
        elif command in {"connection", "inspect", "capture", "project"}:
            callback = {"connection": ws.save_connection, "inspect": ws.inspect_connection,
                        "capture": ws.prepare_capture, "project": ws.project}[command]
            result = callback(input_json(args.file))
        elif command == "run":
            stopped = threading.Event()
            interruption = []
            def interrupt(number, _frame):
                if not interruption:
                    interruption.append(number)
                # Signal handlers never re-enter a SQLite transaction.
                stopped.set()
            old = {number: signal.signal(number, interrupt) for number in (signal.SIGINT, signal.SIGTERM)}
            try:
                result = ws.run_capture(args.capture, args.expected_revision, cancel_event=stopped)
            finally:
                for number, callback in old.items():
                    signal.signal(number, callback)
            emit(result)
            if interruption:
                return 130 if interruption[0] == signal.SIGINT else 143
            return 0 if result["status"] == "COMPLETE" else 2
        elif command == "cancel":
            result = ws.cancel_capture(args.capture)
        elif command == "messages":
            result = ws.messages(args.capture, args.offset, args.limit)
        elif command == "message":
            result = ws.message(args.id)
        elif command == "source":
            with Path(args.file).open("rb") as stream:
                result = ws.add_source(stream, args.label, Path(args.file).name)
        elif command == "plan":
            result = ws.save_plan(input_json(args.file))
        elif command == "build":
            result = ws.build(args.source, args.plan)
        elif command == "query":
            result = ws.query(args.build, load_json(args.params))
        elif command == "compare":
            result = ws.compare(args.before, args.after)
        elif command == "changes":
            result = ws.comparison_page(args.comparison, args.offset, args.limit)
        elif command == "export":
            result = ws.export_kafka(args.build, Path(args.out).absolute(), args.projection)
        elif command == "dataset":
            result = ws.export_dataset(args.build, Path(args.out).absolute())
        elif command == "native-export":
            result = ws.export_packet(args.build, Path(args.out).absolute())
        elif command == "import":
            result = ws.import_kafka(Path(args.file))
        elif command == "native-import":
            result = ws.import_packet(Path(args.file))
        elif command == "merchant":
            result = ws.prepare_merchant(args.build, input_json(args.payment), args.origin, args.path, args.out)
        elif command == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be from 0 to 65535")
            server = OperatorServer(ws, args.port)
            previous = {}
            interrupted = []
            def terminate(number, _frame):
                if not interrupted:
                    interrupted.append(number)
                for kind in (signal.SIGINT, signal.SIGTERM):
                    signal.signal(kind, signal.SIG_IGN)
                raise KeyboardInterrupt
            for kind in (signal.SIGINT, signal.SIGTERM):
                previous[kind] = signal.signal(kind, terminate)
            try:
                with published_connection(args.connection_file, server.url) as connection:
                    server.launch = startup(server, binding, connection)
                    emit(server.launch if args.startup_format == "json" else {
                        "console": server.url, "workspace": str(ws.root),
                        **({"connectionFile": connection} if connection else {})})
                    server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
            finally:
                server.launch = None
                for kind in (signal.SIGINT, signal.SIGTERM):
                    signal.signal(kind, signal.SIG_IGN)
                try:
                    server.server_close()
                    ws.close()
                finally:
                    for kind, callback in previous.items():
                        signal.signal(kind, callback)
            return 0
        emit(result)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (InputError, OSError, ValueError) as error:
        print("Kafka dataset: " + str(error), file=sys.stderr)
        sys.exit(1)
