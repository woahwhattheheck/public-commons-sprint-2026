#!/usr/bin/env python3
"""MIT. Complete IATI source, portfolio, native dataset and managed operator lifecycle."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile

from iati_workspace import IatiWorkspace, InputError, load_json
from server import OperatorServer
from managed import inspect_binding, require_binding, startup


@contextmanager
def published_connection(filename, url):
    if filename is None:
        yield None
        return
    destination = Path(filename).expanduser().absolute()
    if destination.parent.resolve(strict=True) != destination.parent:
        raise InputError("Choose an original private connection directory without aliases")
    info = destination.parent.stat()
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise InputError("Keep the connection directory private and operator-owned")
    encoded = (url + "\n").encode()
    descriptor, temporary = tempfile.mkstemp(prefix=".iati-connection-", dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.chmod(temporary, 0o600)
            output.write(encoded); output.flush(); os.fsync(output.fileno())
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError as error:
            raise InputError("Use the existing running console connection, or reconcile its ended process before selecting a new file") from error
        own = destination.lstat()
    finally:
        temporary.unlink(missing_ok=True)
    try:
        yield str(destination)
    finally:
        try:
            current = destination.lstat()
            if stat.S_ISREG(current.st_mode) and (current.st_dev, current.st_ino) == (own.st_dev, own.st_ino) \
                    and current.st_size == len(encoded) and destination.read_bytes() == encoded:
                destination.unlink()
        except FileNotFoundError:
            pass


def original_json(filename):
    with Path(filename).open("rb") as stream:
        data = stream.read(131073)
    if len(data) > 131072:
        raise InputError("Use a complete original JSON selection within 128 KiB")
    return load_json(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Operate retained IATI aid-finance sources with original native SF30 datasets")
    parser.add_argument("--workspace", required=True, help="Original private workspace directory")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ["init", "list", "binding", "presets", "portfolios"]:
        sub.add_parser(name)
    source = sub.add_parser("source")
    source.add_argument("--file", required=True); source.add_argument("--label", default="IATI publisher source")
    for name in ["inspect", "profile"]:
        selected = sub.add_parser(name); selected.add_argument("--source", required=True)
    plan = sub.add_parser("plan"); plan.add_argument("--file", required=True)
    build = sub.add_parser("build"); build.add_argument("--source", required=True); build.add_argument("--plan", required=True)
    query = sub.add_parser("query"); query.add_argument("--build", required=True); query.add_argument("--params", default="{}")
    compare = sub.add_parser("compare"); compare.add_argument("--before", required=True); compare.add_argument("--after", required=True)
    changes = sub.add_parser("changes"); changes.add_argument("--comparison", required=True)
    changes.add_argument("--offset", type=int, default=0); changes.add_argument("--limit", type=int, default=50)
    for name in ["export", "dataset"]:
        selected = sub.add_parser(name); selected.add_argument("--build", required=True); selected.add_argument("--out", required=True)
    for name in ["import", "receive"]:
        selected = sub.add_parser(name); selected.add_argument("--file", required=True)
    save = sub.add_parser("portfolio-save"); save.add_argument("--file", required=True)
    for name in ["portfolio", "report", "portfolio-export", "report-export"]:
        selected = sub.add_parser(name); selected.add_argument("--id", required=True); selected.add_argument("--revision", type=int)
        if name.endswith("-export"): selected.add_argument("--out", required=True)
    history = sub.add_parser("history"); history.add_argument("--id", required=True)
    compared = sub.add_parser("portfolio-compare"); compared.add_argument("--file", required=True)
    serve = sub.add_parser("serve"); serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--connection-file")
    serve.add_argument("--expected-binding")
    serve.add_argument("--startup-format", choices=["legacy", "json"], default="legacy")
    args = parser.parse_args(argv)
    if args.command == "binding":
        print(json.dumps(inspect_binding(args.workspace), ensure_ascii=False, separators=(",", ":"), allow_nan=False), flush=True)
        return
    managed = args.command == "serve" and (args.startup_format == "json" or args.expected_binding is not None)
    binding = require_binding(args.workspace, args.expected_binding) if managed else None
    with IatiWorkspace(args.workspace, create=args.command == "init") as ws:
        if binding is not None: binding = require_binding(str(ws.root), binding["sha256"])
        command = args.command
        if command in {"init", "list"}: result = ws.state()
        elif command == "presets": result = ws.presets()
        elif command == "portfolios": result = ws.portfolios()
        elif command == "source":
            with Path(args.file).open("rb") as stream: result = ws.add_source(stream, args.label, Path(args.file).name)
        elif command == "inspect": result = ws.source(args.source)
        elif command == "profile": result = ws.profile(args.source)
        elif command == "plan": result = ws.save_plan(original_json(args.file))
        elif command == "build": result = ws.build(args.source, args.plan)
        elif command == "query": result = ws.query(args.build, load_json(args.params))
        elif command == "compare": result = ws.compare(args.before, args.after)
        elif command == "changes": result = ws.comparison_page(args.comparison, args.offset, args.limit)
        elif command == "export": result = ws.export_packet(args.build, Path(args.out).absolute())
        elif command == "dataset": result = ws.export_dataset(args.build, args.out)
        elif command == "import": result = ws.import_packet(Path(args.file))
        elif command == "receive": result = ws.receive_portfolio(Path(args.file))
        elif command == "portfolio-save": result = ws.save_portfolio(original_json(args.file))
        elif command == "portfolio": result = ws.portfolio(args.id, args.revision)
        elif command == "report": result = ws.report(args.id, args.revision)
        elif command == "portfolio-export": result = ws.export_portfolio(args.id, Path(args.out).absolute(), args.revision)
        elif command == "report-export": result = ws.write_report(args.id, Path(args.out).absolute(), args.revision)
        elif command == "history": result = ws.history(args.id)
        elif command == "portfolio-compare": result = ws.compare_portfolio(original_json(args.file))
        elif command == "serve":
            if not 0 <= args.port <= 65535: raise InputError("Choose a port from 0 to 65535")
            server = OperatorServer(ws, args.port)
            def terminate(_signal, _frame):
                server.launch = None
                raise KeyboardInterrupt
            previous = signal.signal(signal.SIGTERM, terminate)
            try:
                with published_connection(args.connection_file, server.url) as connection:
                    if binding is not None: server.launch = startup(server, binding, connection)
                    message = server.launch if args.startup_format == "json" else {
                        "console": server.url, "workspace": str(ws.root),
                        **({"connectionFile": connection} if connection else {})}
                    print(json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False), flush=True)
                    server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
            finally:
                server.launch = None
                signal.signal(signal.SIGTERM, signal.SIG_IGN); signal.signal(signal.SIGINT, signal.SIG_IGN)
                try: server.server_close()
                finally: signal.signal(signal.SIGTERM, previous)
            return
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    try: main()
    except (InputError, OSError, ValueError) as error:
        print(f"IATI dataset: {error}", file=sys.stderr); sys.exit(1)
