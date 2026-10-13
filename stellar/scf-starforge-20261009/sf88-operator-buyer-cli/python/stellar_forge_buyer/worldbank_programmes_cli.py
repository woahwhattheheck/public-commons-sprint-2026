"""Operate named World Bank programmes through the original live Analysis owner."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
from pathlib import Path
import stat
import sys
import tempfile
import time
import webbrowser

from .analysis_workspace import AnalysisWorkspace, serve
from .errors import BuyerError, StateError
from .storage import parse, private_directory, read, sync_directory


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _request(path):
    value = parse(read(Path(path).expanduser().absolute(), 1024 * 1024))
    if not isinstance(value, dict):
        raise StateError("WORLDBANK_PROGRAMME_REQUEST_OBJECT_REQUIRED")
    return value


def _receive_file(source, destination, record):
    destination = Path(destination).expanduser().absolute()
    private_directory(destination.parent, create=True)
    if destination.resolve() != destination:
        raise StateError("WORLDBANK_PROGRAMME_OUTPUT_PATH_INVALID")

    def verified(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size != record["bytes"]:
                raise StateError("WORLDBANK_PROGRAMME_OUTPUT_CHANGED")
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
            after = os.fstat(stream.fileno())
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise StateError("WORLDBANK_PROGRAMME_OUTPUT_CHANGED")
            if digest != record["sha256"]:
                raise StateError("WORLDBANK_PROGRAMME_OUTPUT_CHANGED")
            os.fsync(stream.fileno())

    if os.path.lexists(destination):
        verified(destination)
        sync_directory(destination.parent)
        return {"path": str(destination), **record, "reused": True}
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".worldbank-download-", dir=destination.parent)
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(source_fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != record["bytes"]:
                    raise StateError("WORLDBANK_PROGRAMME_DELIVERY_CHANGED")
                value, size = hashlib.sha256(), 0
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(block)
                    if size > record["bytes"]:
                        raise StateError("WORLDBANK_PROGRAMME_DELIVERY_CHANGED")
                    value.update(block)
                    output.write(block)
                if size != record["bytes"] or value.hexdigest() != record["sha256"]:
                    raise StateError("WORLDBANK_PROGRAMME_DELIVERY_CHANGED")
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError:
            verified(destination)
        sync_directory(destination.parent)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
            sync_directory(destination.parent)
    return {"path": str(destination), **record, "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--worldbank-core", help="Original installed core.py; never supplied by browser requests")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("list", "sources"):
        item = commands.add_parser(command)
        item.add_argument("--before")
        item.add_argument("--limit", type=int, default=50)
    item = commands.add_parser("show")
    item.add_argument("--name", required=True)
    item = commands.add_parser("history")
    item.add_argument("--name", required=True)
    item.add_argument("--before", type=int)
    item.add_argument("--limit", type=int, default=50)
    for command in ("save", "prepare", "publish", "reopen"):
        item = commands.add_parser(command)
        item.add_argument("--name", required=True)
        item.add_argument("--request", required=True, help="Exact original JSON request; keep its ID on continuation")
    for command in ("operation", "review"):
        item = commands.add_parser(command)
        item.add_argument("--name", required=True)
        item.add_argument("--id", required=True)
    item = commands.add_parser("download")
    item.add_argument("--name", required=True)
    item.add_argument("--id", required=True)
    item.add_argument("--filename", required=True)
    item.add_argument("--out", required=True)
    item = commands.add_parser("serve")
    item.add_argument("--port", type=int, default=0)
    item.add_argument("--open", action="store_true")
    args = parser.parse_args(argv)
    workspace = None
    previous_term = signal.getsignal(signal.SIGTERM)
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        workspace = AnalysisWorkspace(args.workspace, worldbank_core=args.worldbank_core)
        manager = workspace.worldbank_programmes
        if args.command == "serve":
            server, control, url = serve(workspace, port=args.port)
            print(_json({"status": "LISTENING", "address": url.split("#", 1)[0],
                         "private_launch": str(control), "workspace_id": workspace.identity}), flush=True)
            if args.open:
                webbrowser.open(url)
            try:
                server.serve_forever(poll_interval=0.2)
            finally:
                server.server_close()
                control.unlink(missing_ok=True)
            return 0
        if args.command in ("list", "sources"):
            before = int(args.before) if args.command == "sources" and args.before else args.before
            result = getattr(manager, args.command)(before=before, limit=args.limit)
        elif args.command == "show":
            result = manager.definition(args.name)
        elif args.command == "history":
            result = manager.history(args.name, before=args.before, limit=args.limit)
        elif args.command in ("save", "prepare", "publish", "reopen"):
            request = _request(args.request)
            result = getattr(manager, args.command)(args.name, request)
            if args.command != "save":
                previous = None
                while result["status"] == "RUNNING":
                    marker = (result["status"], result.get("phase"))
                    if marker != previous:
                        print(_json({"operation_id": result["operation_id"],
                                     "status": result["status"], "phase": result.get("phase")}), flush=True)
                        previous = marker
                    time.sleep(0.1)
                    result = manager.status(args.name, request["id"])
        elif args.command == "operation":
            result = manager.status(args.name, args.id)
        elif args.command == "review":
            result = manager.review(args.name, args.id)
        else:
            source, record = manager.download(args.name, args.id, args.filename)
            result = _receive_file(source, args.out, record)
        print(_json(result), flush=True)
        return 1 if isinstance(result, dict) and result.get("status") in ("ERROR", "INTERRUPTED") else 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, OSError, ValueError, TypeError, KeyError) as error:
        print(_json({"error": getattr(error, "code", None) or str(error)}), file=sys.stderr)
        return 1
    finally:
        # The original manager drains its coordinator before Analysis closes.
        old_int = signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            if workspace is not None:
                workspace.close()
        finally:
            signal.signal(signal.SIGINT, old_int)
            signal.signal(signal.SIGTERM, previous_term)


if __name__ == "__main__":
    raise SystemExit(main())
