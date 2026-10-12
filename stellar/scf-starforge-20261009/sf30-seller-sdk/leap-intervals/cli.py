"""MIT. Leap device interval preparation, operation and customer receiving."""
from __future__ import annotations
import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

from leap_contracts import LeapError, require, json_bytes
from leap_workspace import LeapWorkspace, digest_file, sync_directory
from leap_delivery import MAX_PACKET_BYTES, export_path

def load_json(path):
    file = Path(path)
    require(file.stat().st_size <= 2 * 1024 * 1024, "LOCAL_JSON", "The complete action document exceeds 2 MiB.")
    value = json.loads(file.read_text(encoding="utf-8"))
    require(isinstance(value, dict), "LOCAL_JSON", "Use a complete JSON object.")
    return value


def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--request-id", default=argparse.SUPPRESS)
    common.add_argument("--expected-revision", type=int, default=argparse.SUPPRESS)
    root = argparse.ArgumentParser(description="Operate original Leap device interval deliveries.", parents=[common])
    root.add_argument("--workspace", required=True)
    subs = root.add_subparsers(dest="command", required=True)
    for name in ("init", "status"):
        subs.add_parser(name, parents=[common])
    for name in ("configure", "mapping-save", "prepare", "missing"):
        p = subs.add_parser(name, parents=[common])
        p.add_argument("--file", required=True)
    p = subs.add_parser("import", parents=[common])
    p.add_argument("--file", required=True)
    p.add_argument("--format", required=True, choices=["leap-load", "utility-profile", "evidence"])
    p.add_argument("--name")
    for name in ("submit", "refresh", "reconcile"):
        p = subs.add_parser(name, parents=[common])
        p.add_argument("--batch-id", required=True)
        if name == "reconcile":
            p.add_argument("--job-id")
    p = subs.add_parser("export", parents=[common])
    p.add_argument("--batch-id", required=True)
    p.add_argument("--out", required=True)
    p = subs.add_parser("restore", parents=[common])
    p.add_argument("--file", required=True)
    p = subs.add_parser("serve", parents=[common])
    p.add_argument("--port", type=int, default=0)
    p.add_argument("--connection-file")
    p = subs.add_parser("inspect", parents=[common])
    p.add_argument("--collection", required=True)
    p.add_argument("--id")
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=100)
    p = subs.add_parser("action", parents=[common])
    p.add_argument("--name", required=True)
    p.add_argument("--file", required=True)
    p = subs.add_parser("operation", parents=[common])
    p.add_argument("--id", required=True)
    return root


def original_input(path):
    path = Path(path).absolute()
    info = path.lstat()
    require(path.is_file() and not path.is_symlink(), "LOCAL_SOURCE", "Choose an original regular input file.")
    return path, info


def receive_export(source, destination, metadata):
    def original_destination():
        info = destination.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(),
                "LOCAL_EXPORT_EXISTS", "Use the original received file or choose a new filename.")
        require(digest_file(destination) == (metadata["bytes"], metadata["sha256"]),
                "LOCAL_EXPORT_EXISTS", "The receiving filename contains different bytes; choose a new filename.")
    if destination.exists() or destination.is_symlink():
        original_destination()
        return
    fd, temporary = tempfile.mkstemp(prefix=".leap-export-", dir=destination.parent)
    try:
        with open(source, "rb") as src, os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        require(digest_file(temporary) == (metadata["bytes"], metadata["sha256"]),
                "LOCAL_EXPORT_CHANGED", "The received export differs from its complete retained bytes.")
        try:
            # An atomic no-overwrite publication in the chosen receiving directory.
            os.link(temporary, destination)
        except FileExistsError:
            original_destination()
        sync_directory(destination.parent)
    finally:
        os.unlink(temporary)


def main(argv=None):
    args = parser().parse_args(argv)
    with contextlib.closing(LeapWorkspace(args.workspace)) as work:
        options = {"request_id": getattr(args, "request_id", None), "expected_revision": getattr(args, "expected_revision", None)}
        if args.command in {"init", "status"}:
            result = work.state()
        elif args.command == "serve":
            from leap_server import serve
            serve(work, port=args.port, connection_file=args.connection_file)
            return 0
        elif args.command == "inspect":
            result = work.get(args.collection, args.id) if args.id else work.list_collection(args.collection, args.offset, args.limit)
        elif args.command == "operation":
            result = work.operation(args.id)
        elif args.command in {"configure", "mapping-save", "prepare", "missing"}:
            action = {"configure": "configuration.save", "mapping-save": "mapping.save", "prepare": "batch.prepare", "missing": "missing.refresh"}[args.command]
            result = work.perform(action, load_json(args.file), **options)
        elif args.command == "action":
            result = work.perform(args.name, load_json(args.file), **options)
        elif args.command in {"import", "restore"}:
            path, info = original_input(args.file)
            with open(path, "rb") as source:
                if args.command == "restore":
                    blob = work.store_stream(source, path.name, "restore-packet", expected_bytes=info.st_size, maximum=MAX_PACKET_BYTES)
                    action, payload = "workspace.restore", {"file_id": blob["id"]}
                else:
                    blob = work.store_stream(source, args.name or path.name, args.format, expected_bytes=info.st_size)
                    action, payload = "source.register", {"id": blob["id"], "format": args.format, "name": args.name or path.name}
            after = path.stat()
            require((after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                    == (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns),
                    "LOCAL_SOURCE_CHANGED", "The original input changed while being received.")
            result = work.perform(action, payload, **options)
        elif args.command in {"submit", "refresh", "reconcile"}:
            payload = {"batch_id": args.batch_id}
            if args.command == "reconcile" and args.job_id:
                payload["job_id"] = args.job_id
            result = work.perform("batch." + args.command, payload, **options)
        elif args.command == "export":
            destination = Path(args.out).absolute()
            result = work.perform("package.export", {"batch_id": args.batch_id}, **options)
            require(isinstance(result["result"], dict) and result["result"].get("id"), "LOCAL_EXPORT", "Resume the original export operation.")
            path, meta = export_path(work, result["result"]["id"])
            receive_export(path, destination, meta)
            result["received_file"] = {"path": str(destination), "bytes": meta["bytes"], "sha256": meta["sha256"]}
        else:
            raise LeapError("LOCAL_COMMAND", "Choose an original application command.")
        print(json_bytes(result).decode(), end="", flush=True)
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (LeapError, ValueError, TypeError, OSError) as error:
        document = LeapWorkspace.error_document(error)
        print(json_bytes({"error": document}).decode(), file=sys.stderr, end="", flush=True)
        raise SystemExit(2)
