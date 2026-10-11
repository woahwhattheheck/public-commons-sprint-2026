"""Command-line operations for the retained Mercury workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import sys
import tempfile
import threading
from pathlib import Path

from . import __version__
from .config import initialize_workspace, load_config
from .engine import Engine
from .web import make_server, _safe_message


def output(value, *, stream=sys.stdout):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2), file=stream, flush=True)


def error_record(error, config=None):
    if hasattr(error, "code"):
        message = _safe_message(error, config) if config else str(getattr(error, "message", "Configuration is invalid."))
        return {"code": str(error.code), "message": message[:1000]}
    if isinstance(error, (ValueError, FileExistsError)):
        return {"code": "INVALID_OPERATION", "message": _safe_message(error, config) if config else str(error)[:1000]}
    if isinstance(error, OSError):
        return {"code": "FILESYSTEM_ERROR", "message": error.strerror or "The filesystem operation failed."}
    return {"code": "OPERATION_FAILED", "message": "The operation failed. Inspect the configured workspace and retained operation details."}


def _common(parser, *, child=False):
    default = argparse.SUPPRESS if child else "./config.json"
    parser.add_argument("--config", default=default, help="Private configuration JSON path (default: ./config.json)")
    parser.add_argument("--env-file", default=argparse.SUPPRESS if child else None,
                        help="Explicit private NAME=value environment file")


def parser():
    root = argparse.ArgumentParser(prog="mercury-ops", allow_abbrev=False,
                                   description="Operate one retained Mercury ingestion, reconciliation and customer-delivery workspace.")
    root.add_argument("--version", action="version", version=__version__)
    _common(root)
    commands = root.add_subparsers(dest="command", required=True)
    def command(name, help):
        item = commands.add_parser(name, help=help, allow_abbrev=False)
        _common(item, child=True)
        return item
    init = command("init", "Create private configuration and environment files")
    init.add_argument("directory")
    init.add_argument("--network", default="mainnet")
    serve = command("serve", "Run the operator UI, notification endpoint and owned worker")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8787)
    serve.add_argument("--allowed-host", help="Exact public host[:port] used by the trusted reverse proxy")
    serve.add_argument("--behind-https-proxy", action="store_true")
    command("status", "Read sanitized configuration and retained operation counts")
    once = command("run-once", "Process retained work without starting an HTTP server")
    once.add_argument("--max-operations", type=int, default=1)
    command("worker", "Run only the owned worker until interrupted")
    catchup = command("catchup", "Retain a resumable inclusive ledger-range job")
    catchup.add_argument("job_id", help="Stable operator-chosen job ID; reuse it for the same request")
    catchup.add_argument("--ledger-from", type=int, required=True)
    catchup.add_argument("--ledger-to", type=int, required=True)
    catchup.add_argument("--contract", action="append", dest="contracts")
    catchup.add_argument("--page-size", type=int)
    reconcile = command("reconcile", "Retain canonical reconciliation for one transaction")
    reconcile.add_argument("tx_hash")
    reconcile.add_argument("--operation-id")
    lists = command("list", "Page through retained records")
    lists.add_argument("kind", choices=["events", "notifications", "catchups", "tasks", "deliveries"])
    lists.add_argument("--limit", type=int, default=100, help="Records per page, from 1 to 500 (default: 100)")
    lists.add_argument("--after")
    lists.add_argument("--state")
    detail = command("show", "Read one retained record with its original details")
    detail.add_argument("kind", choices=["event", "notification", "catchup", "task", "delivery"])
    detail.add_argument("identity")
    retry = command("retry", "Explicitly retry retained work; a delivery keeps its original event key")
    retry.add_argument("kind", choices=["task", "catchup", "delivery"])
    retry.add_argument("identity")
    cancel = command("cancel", "Cancel a retained catch-up job")
    cancel.add_argument("job_id")
    command("recover", "Recover interrupted work while respecting a live worker")
    export = command("export", "Create a complete private operations NDJSON file")
    export.add_argument("--out", required=True)
    export.add_argument("--events-only", action="store_true", help="Export only canonical event envelopes")
    backup = command("backup", "Create a private portable workspace backup archive")
    backup.add_argument("--out", required=True)
    restore = command("restore", "Restore a private workspace backup archive into a new directory")
    restore.add_argument("--from", dest="database", required=True)
    restore.add_argument("--into", required=True)
    return root


def publish_export(engine, destination, *, events_only=False):
    destination = Path(destination).expanduser().resolve()
    if destination.exists():
        raise FileExistsError("The export destination already exists. Choose a new filename.")
    if not destination.parent.is_dir():
        raise ValueError("The export parent directory must already exist.")
    count, digest = 0, hashlib.sha256()
    descriptor, temporary = tempfile.mkstemp(prefix=".mercury-export-", dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            iterator = engine.iter_event_export() if events_only else engine.iter_operations_export()
            for chunk in iterator:
                if not isinstance(chunk, bytes):
                    raise RuntimeError("Export iterator must yield bytes.")
                stream.write(chunk)
                count += len(chunk)
                digest.update(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        # Same-directory hard-link publication is atomic and never replaces an existing file.
        os.link(temporary, destination)
        directory_fd = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"path": str(destination), "bytes": count, "sha256": digest.hexdigest(),
                "kind": "canonical_events" if events_only else "operations"}
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _signals(stop):
    previous = {}
    if threading.current_thread() is threading.main_thread():
        def interrupted(signum, frame):
            stop.set()
            raise KeyboardInterrupt
        for number in (signal.SIGINT, signal.SIGTERM):
            previous[number] = signal.signal(number, interrupted)
    return previous


def _restore_signals(previous):
    for number, handler in previous.items():
        signal.signal(number, handler)


def serve(config, engine, args):
    server = make_server(config, engine, host=args.host, port=args.port,
                         allowed_host=args.allowed_host, behind_https_proxy=args.behind_https_proxy)
    stop = threading.Event()
    server.worker_status = {"state": "starting"}
    def run_worker():
        server.worker_status = {"state": "running"}
        try:
            engine.run_forever(stop)
        except Exception as error:
            server.worker_status = {"state": "failed", "error": error_record(error, config)}
            output({"worker": server.worker_status}, stream=sys.stderr)
        finally:
            if server.worker_status["state"] != "failed":
                server.worker_status = {"state": "stopped"}
    worker = threading.Thread(target=run_worker, name="mercury-owned-worker")
    previous = _signals(stop)
    try:
        engine.recover()
        worker.start()
        host = args.allowed_host if args.allowed_host else (
            ("[" + args.host + "]" if ":" in args.host else args.host) + ":" + str(server.server_address[1]))
        output({"state": "serving", "url": ("https://" if args.behind_https_proxy else "http://") + host,
                "webhook_path": "/webhooks/mercury", "configuration": config.public_dict()})
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        if worker.ident is not None:
            worker.join()
        _restore_signals(previous)
    return 1 if server.worker_status["state"] == "failed" else 0


def main(argv=None):
    args = parser().parse_args(argv)
    config = None
    try:
        if args.command == "init":
            # This is the one intentional token display, in the initiating operator's terminal.
            output(initialize_workspace(Path(args.directory), network=args.network))
            return 0
        if args.command == "restore":
            from .maintenance import restore_workspace
            output(restore_workspace(args.database, args.into))
            return 0
        config = load_config(args.config, env_file=args.env_file)
        engine = Engine(config)
        if args.command == "serve":
            if not 0 <= args.port <= 65535:
                raise ValueError("Port must be from 0 to 65535.")
            return serve(config, engine, args)
        if args.command == "status":
            output({"configuration": config.public_dict(), "operations": engine.status(), "version": __version__})
        elif args.command == "run-once":
            if not 1 <= args.max_operations <= 100000:
                raise ValueError("Max operations must be from 1 to 100000.")
            operations = []
            for _ in range(args.max_operations):
                item = engine.run_once()
                operations.append(item)
                if not item.get("worked"):
                    break
            output({"operations": operations, "worked": sum(bool(item.get("worked")) for item in operations)})
            return 1 if any(item.get("state") in ("failed", "uncertain") for item in operations) else 0
        elif args.command == "worker":
            stop = threading.Event()
            previous = _signals(stop)
            try:
                engine.recover()
                output({"state": "worker_running", "configuration": config.public_dict()})
                engine.run_forever(stop)
            except KeyboardInterrupt:
                stop.set()
            finally:
                _restore_signals(previous)
        elif args.command == "catchup":
            values = {"contracts": args.contracts, "ledger_from": args.ledger_from,
                      "ledger_to": args.ledger_to, "page_size": args.page_size}
            output(engine.create_catchup(args.job_id, **values))
        elif args.command == "reconcile":
            output(engine.reconcile_tx(args.tx_hash, operation_id=args.operation_id))
        elif args.command == "list":
            methods = {"events": "list_events", "notifications": "list_notifications",
                       "catchups": "list_jobs", "tasks": "list_tasks", "deliveries": "list_deliveries"}
            values = {"limit": args.limit, "after": args.after}
            if args.state:
                if args.kind == "events":
                    raise ValueError("Canonical events have no mutable state filter; filter deliveries instead.")
                values["state"] = args.state
            output(getattr(engine, methods[args.kind])(**values))
        elif args.command == "show":
            methods = {"event": "get_event", "notification": "get_notification", "catchup": "get_job",
                       "task": "get_task", "delivery": "get_delivery"}
            output(getattr(engine, methods[args.kind])(args.identity))
        elif args.command == "retry":
            methods = {"task": "retry_task", "catchup": "retry_job", "delivery": "retry_delivery"}
            output(getattr(engine, methods[args.kind])(args.identity))
        elif args.command == "cancel":
            output(engine.cancel_job(args.job_id))
        elif args.command == "recover":
            output(engine.recover())
        elif args.command == "export":
            output(publish_export(engine, args.out, events_only=args.events_only))
        elif args.command == "backup":
            from .maintenance import backup_workspace
            output(backup_workspace(engine, args.out))
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        output({"error": error_record(error, config)}, stream=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
