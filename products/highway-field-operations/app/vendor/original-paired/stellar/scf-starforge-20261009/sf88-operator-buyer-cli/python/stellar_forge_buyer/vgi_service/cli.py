"""Installed command for the native purchased-result VGI service."""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import signal
import sys
import webbrowser

from ..duckdb_dataset import DuckDBWorkspace
from ..errors import BuyerError, StateError
from ..storage import parse, read


def _print(value, *, error=False, compact=False):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=None if compact else 2),
          file=sys.stderr if error else sys.stdout, flush=True)


def _locations(path):
    if not path:
        return {}
    value = parse(read(Path(path).expanduser().resolve(strict=True), 1024 * 1024))
    if not isinstance(value, dict):
        raise StateError("VGI_EXPORT_LOCATIONS_INVALID")
    return value


def parser():
    p = argparse.ArgumentParser(
        prog="stellar-forge-vgi-results",
        description="Publish complete original DuckDB query exports through VGI.")
    p.add_argument("--workspace", help="Original private DuckDB buyer warehouse directory")
    p.add_argument("--export-locations", metavar="JSON",
                   help="Receiver-local export ID to exact original export directory mapping")
    p.add_argument("--memory-limit", default="128MB")
    p.add_argument("--threads", type=int, default=1)
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("runtime", help="Inspect the selected Python and vendor source installation")
    commands.add_parser("state", help="Read catalog, publications and original workspace identity")
    review = commands.add_parser("review", help="Verify one original completed query export")
    review.add_argument("export_id")
    review.add_argument("--batch-rows", type=int, default=4096,
                        help="Reviewed Parquet read size, 1..4096 rows before the IPC byte limit")
    configure = commands.add_parser("configure", help="Save reviewed catalog and current access")
    configure.add_argument("--catalog", required=True)
    configure.add_argument("--label", default="Native purchased results")
    configure.add_argument("--principal", action="append", default=[])
    configure.add_argument("--allow-local", action=argparse.BooleanOptionalAction, default=False)
    configure.add_argument("--expected-revision", type=int, required=True)
    configure.add_argument("--request-id", required=True)
    publish = commands.add_parser("publish", help="Retain a verified export as an immutable publication")
    publish.add_argument("--table", required=True)
    publish.add_argument("--export-id", required=True)
    publish.add_argument("--review-sha256", required=True)
    publish.add_argument("--expected-head-revision", type=int, required=True)
    publish.add_argument("--request-id", required=True)
    activate = commands.add_parser("activate", help="Select a retained table edition or retire its alias")
    activate.add_argument("--table", required=True)
    activate.add_argument("--publication-id", required=True)
    activate.add_argument("--expected-head-revision", type=int, required=True)
    activate.add_argument("--active", action=argparse.BooleanOptionalAction, default=True)
    activate.add_argument("--request-id", required=True)
    workspace = commands.add_parser("workspace", help="Open the original private buyer and VGI operator")
    workspace.add_argument("--port", type=int, default=0)
    workspace.add_argument("--open", action="store_true")
    workspace.add_argument("--export-root")
    workspace.add_argument("--handoff-root")
    http = commands.add_parser("http", help="Run the authenticated native VGI HTTP listener in foreground")
    http.add_argument("--host", default="127.0.0.1")
    http.add_argument("--port", type=int, default=0)
    http.add_argument("--expected-revision", type=int, required=True)
    http.add_argument("--request-id", required=True)
    commands.add_parser("stdio", help="Run the original VGI Arrow protocol on stdin/stdout")
    handoff = commands.add_parser("handoff", help="Use the original complete warehouse backup")
    handoff.add_argument("--destination", required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    workspace = runtime = server = None
    prior_term = None
    try:
        from .runtime import HTTPRuntime, require_runtime, runtime_info
        if args.command == "runtime":
            value = runtime_info()
            _print(value)
            return 0 if value["ready"] else 1
        if not args.workspace:
            raise StateError("VGI_ORIGINAL_WORKSPACE_REQUIRED")
        require_runtime()
        workspace = DuckDBWorkspace(args.workspace, memory_limit=args.memory_limit,
                                    threads=args.threads)
        from .model import VgiService
        service = VgiService(workspace, export_locations=_locations(args.export_locations))

        def terminated(_signum, _frame):
            raise KeyboardInterrupt

        if args.command in {"workspace", "http", "stdio"}:
            prior_term = signal.signal(signal.SIGTERM, terminated)
        if args.command == "state":
            _print(service.state())
        elif args.command == "review":
            _print(service.review_export(args.export_id, batch_rows=args.batch_rows))
        elif args.command == "configure":
            _print(service.configure({
                "request_id": args.request_id, "expected_revision": args.expected_revision,
                "configuration": {"catalog_name": args.catalog, "label": args.label,
                                  "principals": args.principal,
                                  "allow_local": args.allow_local}}))
        elif args.command == "publish":
            _print(service.publish({
                "request_id": args.request_id, "table_name": args.table,
                "export_id": args.export_id, "review_sha256": args.review_sha256,
                "expected_head_revision": args.expected_head_revision}))
        elif args.command == "activate":
            _print(service.activate({
                "request_id": args.request_id, "table_name": args.table,
                "publication_id": args.publication_id, "active": args.active,
                "expected_head_revision": args.expected_head_revision}))
        elif args.command == "handoff":
            _print(workspace.backup(args.destination))
        elif args.command == "workspace":
            from ..duckdb_http import serve
            server, control, url = serve(workspace, port=args.port,
                export_root=args.export_root, handoff_root=args.handoff_root,
                vgi=True, vgi_export_locations=_locations(args.export_locations))
            _print({"status": "LISTENING", "address": url.split("#", 1)[0],
                    "workspace_id": workspace.identity()["workspace_id"],
                    "private_launch": str(control)}, compact=True)
            if args.open:
                webbrowser.open(url)
            server.serve_forever()
        elif args.command == "http":
            runtime = HTTPRuntime(service)
            value = runtime.start(request_id=args.request_id,
                expected_revision=args.expected_revision, host=args.host, port=args.port)
            _print({"status": "LISTENING", "address": value["address"],
                    "workspace_id": value["workspace_id"],
                    "private_launch": str(runtime.record_path),
                    "catalog": value["catalog"]}, compact=True)
            runtime.wait()
        elif args.command == "stdio":
            from .worker import build_worker
            worker, _descriptor = build_worker(service, local=True)
            # The SDK owns stdout; only original Arrow protocol bytes use it.
            worker(quiet=True, log_level=logging.WARNING).run()
        return 0
    except KeyboardInterrupt:
        return 0
    except BuyerError as error:
        _print({"error": error.code}, error=True)
        return 1
    except (OSError, ValueError, TypeError, ImportError) as error:
        _print({"error": "VGI_INPUT_RUNTIME_OR_STORAGE_ERROR",
                "detail": str(error)[:1000]}, error=True)
        return 1
    finally:
        if runtime is not None:
            runtime.close()
        if server is not None:
            server.server_close()
        if workspace is not None:
            workspace.close()
        if prior_term is not None:
            signal.signal(signal.SIGTERM, prior_term)


if __name__ == "__main__":
    raise SystemExit(main())
