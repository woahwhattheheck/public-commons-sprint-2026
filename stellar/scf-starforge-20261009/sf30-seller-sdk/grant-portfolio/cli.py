#!/usr/bin/env python3
"""MIT. Complete native grant portfolio operations and private console."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import signal
import sys
import threading
import tempfile
import uuid

from domain import InputError, MAX_JSON, canonical, parse, require
from managed import require_binding
from workspace import Workspace, sync_dir
from native_sources import file_info


def output(value):
    sys.stdout.buffer.write(canonical(value))
    sys.stdout.buffer.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("binding")
    commands.add_parser("state")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--connection-file")
    serve.add_argument("--expected-binding")
    serve.add_argument("--startup-format", choices=("json",), default="json")
    upload = commands.add_parser("upload")
    upload.add_argument("--file", required=True)
    source = commands.add_parser("source")
    source.add_argument("--id", required=True)
    portfolio = commands.add_parser("portfolio")
    portfolio.add_argument("--id", required=True)
    portfolio.add_argument("--revision", type=int)
    rows = commands.add_parser("rows")
    rows.add_argument("--portfolio-id", required=True)
    rows.add_argument("--revision", required=True, type=int)
    rows.add_argument("--table", required=True)
    rows.add_argument("--offset", type=int, default=0)
    rows.add_argument("--limit", type=int, default=50)
    rows.add_argument("--search", default="")
    rows.add_argument("--status", default="")
    rows.add_argument("--standard", default="")
    detail = commands.add_parser("detail")
    detail.add_argument("--portfolio-id", required=True)
    detail.add_argument("--revision", required=True, type=int)
    detail.add_argument("--source-id", required=True)
    detail.add_argument("--entity-key", required=True)
    action = commands.add_parser("action")
    action.add_argument("--file", required=True, help="Complete JSON action with its original operationId")
    for command in ("request", "resume"):
        sub = commands.add_parser(command)
        sub.add_argument("--id", required=True)
    export = commands.add_parser("export")
    export.add_argument("--portfolio-id", required=True)
    export.add_argument("--revision", required=True, type=int)
    export.add_argument("--operation-id", required=True)
    export.add_argument("--out", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "binding":
        output(require_binding(args.workspace))
        return 0
    before = require_binding(args.workspace, args.expected_binding) if args.command == "serve" else None
    with Workspace(args.workspace, create=args.command == "init") as workspace:
        if args.command == "serve":
            from server import Console
            binding = require_binding(args.workspace, before["sha256"])
            require(0 <= args.port <= 65535, "Select a valid loopback port")
            console = Console(workspace, args.port)
            stopped = threading.Event()
            def stop(_signum, _frame):
                stopped.set()
            for name in (signal.SIGTERM, signal.SIGINT):
                signal.signal(name, stop)
            try:
                output(console.start(binding, args.connection_file))
                stopped.wait()
            finally:
                if console.http_thread.is_alive():
                    console.close()
                else:
                    console.http.server_close()
            return 0
        if args.command in {"init", "state"}:
            result = workspace.state()
        elif args.command == "upload":
            path = Path(args.file).resolve(strict=True)
            require(path.is_file() and not path.is_symlink(), "Use a complete regular source packet")
            with path.open("rb") as stream:
                result = workspace.upload(stream, path.stat().st_size)
        elif args.command == "source":
            result = workspace.source(args.id)
        elif args.command == "portfolio":
            result = workspace.portfolio(args.id, args.revision)
        elif args.command == "rows":
            result = workspace.rows(args.portfolio_id, args.revision, args.table, args.offset, args.limit,
                                    args.search, args.status, args.standard)
        elif args.command == "detail":
            result = workspace.detail(args.portfolio_id, args.revision, args.source_id, args.entity_key)
        elif args.command == "request":
            result = workspace.request(args.id)
        elif args.command == "action":
            path = Path(args.file).resolve(strict=True)
            require(path.stat().st_size <= MAX_JSON, "Complete action input exceeds 1 MiB")
            original = workspace.admit(parse(path.read_bytes()))
            result = workspace.execute(original["id"])
        elif args.command == "resume":
            result = workspace.execute(args.id)
        else:
            original = workspace.admit({"operationId": args.operation_id, "action": "portfolio.export",
                "payload": {"portfolioId": args.portfolio_id, "revision": args.revision}})
            result = workspace.execute(original["id"])
            if result["state"] == "COMPLETED":
                source, descriptor = workspace.export_file(result["result"]["sha256"])
                destination = Path(args.out).expanduser().absolute()
                expected = {key: descriptor[key] for key in ("sha256", "bytes")}
                if destination.exists() or destination.is_symlink():
                    require(destination.is_file() and not destination.is_symlink()
                            and file_info(destination) == expected,
                            "The existing output belongs to different complete bytes", "OUTPUT_CONFLICT", 409)
                else:
                    fd, name = tempfile.mkstemp(prefix=".grant-export-" + descriptor["sha256"][:16] + "-",
                                                dir=destination.parent)
                    temporary = Path(name)
                    try:
                        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
                            while block := inp.read(1024 * 1024):
                                out.write(block)
                            out.flush()
                            os.fsync(out.fileno())
                        require(file_info(temporary) == expected, "The complete handoff copy changed")
                        try:
                            os.link(temporary, destination)
                        except FileExistsError:
                            require(destination.is_file() and not destination.is_symlink()
                                    and file_info(destination) == expected,
                                    "The output changed before publication", "OUTPUT_CONFLICT", 409)
                        sync_dir(destination.parent)
                    finally:
                        temporary.unlink(missing_ok=True)
                result = {**result, "output": str(destination)}
        output(result)
        return 1 if isinstance(result, dict) and result.get("state") == "FAILED" else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        output({"schema": "stellar-forge.grant-portfolio.v1.error",
                "code": getattr(error, "code", type(error).__name__), "message": str(error)})
        sys.exit(1)
