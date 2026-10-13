"""MIT. Open the source-monitoring workflow in the original NDJSON workspace."""
from __future__ import annotations
import argparse
import io
import json
from pathlib import Path
import signal
import sys
import threading

from model import Workspace, InputError, json_bytes, load_json, private_write, MAX_SOURCE
from web import OperatorServer
import matching
import updates
import review_cycles
import gleif_portfolio
import portfolio_refresh
import portfolio_review_cycles
import review_exchange
import review_exchange_delivery


def exchange_input(filename):
    with Path(filename).open("rb") as stream:
        raw = stream.read(24 * 1024 * 1024 + 1)
    if len(raw) > 24 * 1024 * 1024:
        raise InputError("The complete reviewer command exceeds 24 MiB")
    return load_json(raw)


def exchange_file(filename):
    with Path(filename).open("rb") as stream:
        raw = stream.read(MAX_SOURCE + 1)
    if len(raw) > MAX_SOURCE:
        raise InputError("The complete returned reviewer file exceeds 256 MiB")
    return raw

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, help="Original private NDJSON workspace")
    p.add_argument("--create", action="store_true", help="Create the original workspace once")
    sub = p.add_subparsers(dest="action", required=True)
    server = sub.add_parser("serve"); server.add_argument("--port", type=int, default=0)
    server.add_argument("--connection-file", help="Create the original private one-line console connection")
    server.add_argument("--expected-binding", help="Require the reviewed native workspace, Python and source")
    server.add_argument("--startup-format", choices=["legacy", "json"], default="legacy")
    sub.add_parser("binding", help="Inspect native application identity without opening the workspace writer")
    sub.add_parser("state")
    source = sub.add_parser("receive-published"); source.add_argument("--metadata-url", required=True)
    edition = sub.add_parser("receive-edition")
    edition.add_argument("--metadata", required=True); edition.add_argument("--entities", required=True)
    edition.add_argument("--metadata-url", required=True)
    compare = sub.add_parser("compare"); compare.add_argument("--before", required=True); compare.add_argument("--after", required=True)
    change = sub.add_parser("receive-update"); change.add_argument("--before", required=True); change.add_argument("--after", required=True)
    export = sub.add_parser("export"); export.add_argument("--output", required=True)
    receive = sub.add_parser("import"); receive.add_argument("--input", required=True)
    choices = sub.add_parser("portfolio-cycle-reviews", help="List original attributed portfolio reviews for cycle completion")
    choices.add_argument("--comparison-id", required=True)
    sub.add_parser("cycles", help="List finite customer review cycles")
    cycle = sub.add_parser("cycle"); cycle.add_argument("--id", required=True)
    command = sub.add_parser("cycle-command"); command.add_argument("--input", required=True)
    report = sub.add_parser("cycle-report"); report.add_argument("--id", required=True)
    report.add_argument("--version", required=True, type=int); report.add_argument("--output", required=True)
    report.add_argument("--html", action="store_true")
    gleif_preview = sub.add_parser("gleif-preview", help="Inspect a complete GLEIF research handover; no matching")
    gleif_preview.add_argument("--input", required=True)
    gleif_preview.add_argument("--offset", type=int, default=0)
    gleif_preview.add_argument("--limit", type=int, default=50)
    gleif_receive = sub.add_parser("gleif-receive", help="Receive an explicitly reviewed original handover request")
    gleif_receive.add_argument("--request", required=True)
    gleif_status = sub.add_parser("gleif-intake", help="Reconcile the original intake request")
    gleif_status.add_argument("--request-id", required=True)
    refresh_prepare = sub.add_parser("portfolio-refresh-prepare", help="Compare two original customer portfolio editions")
    refresh_prepare.add_argument("--before", required=True); refresh_prepare.add_argument("--after", required=True)
    sub.add_parser("portfolio-refreshes")
    refresh_view = sub.add_parser("portfolio-refresh")
    refresh_view.add_argument("--id", required=True)
    refresh_view.add_argument("--offset", type=int, default=0); refresh_view.add_argument("--limit", type=int, default=50)
    refresh_view.add_argument("--kind"); refresh_view.add_argument("--query", default="")
    refresh_command = sub.add_parser("portfolio-refresh-command")
    refresh_command.add_argument("--request", required=True)
    refresh_request = sub.add_parser("portfolio-refresh-request"); refresh_request.add_argument("--request-id", required=True)
    refresh_report = sub.add_parser("portfolio-refresh-report")
    refresh_report.add_argument("--id", required=True); refresh_report.add_argument("--output", required=True)
    refresh_report.add_argument("--html", action="store_true")
    exchange_list = sub.add_parser("review-exchanges", help="List original reviewer issues and returned work")
    exchange_list.add_argument("--offset", type=int, default=0)
    exchange_list.add_argument("--limit", type=int, default=50)
    exchange_view = sub.add_parser("review-exchange", help="Open the complete selected reviewer record")
    exchange_view.add_argument("--id", required=True)
    exchange_view.add_argument("--offset", type=int, default=0)
    exchange_view.add_argument("--limit", type=int, default=50)
    for operation in ("review-exchange-issue", "review-exchange-command"):
        item = sub.add_parser(operation)
        item.add_argument("--input", required=True, help="The exact original issue selection or compact command JSON")
    exchange_status = sub.add_parser("review-exchange-request", help="Recover one original reviewer request")
    exchange_status.add_argument("--request-id", required=True)
    exchange_compare = sub.add_parser("review-exchange-compare", help="Read the complete original/current/returned comparison")
    exchange_compare.add_argument("--return-id", required=True)
    exchange_compare.add_argument("--edition-id", required=True)
    exchange_compare.add_argument("--adoption-request-id")
    for operation in ("review-exchange-return-preview", "review-exchange-retain"):
        item = sub.add_parser(operation)
        item.add_argument("--input", required=True, help="The complete original returned JSON or HTML")
        item.add_argument("--media", default="application/octet-stream")
    exchange_download = sub.add_parser("review-exchange-download", help="Save the exact original issued or returned file")
    exchange_download.add_argument("--id", required=True)
    exchange_download.add_argument("--role", required=True, choices=("issued_json", "issued_html", "returned_file"))
    exchange_download.add_argument("--output", required=True)
    args = p.parse_args()
    if args.action == "binding":
        from application_binding import inspect_binding
        sys.stdout.buffer.write(json_bytes(inspect_binding(args.workspace)))
        return
    binding = None
    if args.action == "serve" and (args.expected_binding is not None or args.startup_format == "json"):
        from application_binding import require_binding
        binding = require_binding(args.workspace, args.expected_binding)
    with Workspace(args.workspace, create=args.create) as ws:
        if binding is not None:
            binding = require_binding(str(ws.root), binding["sha256"])
        d = ws.opensanctions
        if args.action == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Port must be from 0 to 65535")
            app = OperatorServer(ws, args.port)
            stop = lambda *_: threading.Thread(target=app.shutdown, daemon=True).start()
            previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
            try:
                if binding is not None or args.connection_file:
                    from application_binding import published_connection, startup
                    connection = published_connection(args.connection_file, app.url)
                else:
                    from contextlib import nullcontext
                    connection = nullcontext(None)
                with connection as connection_file:
                    if binding is not None:
                        app.launch = startup(app, binding, connection_file)
                    announcement = app.launch if args.startup_format == "json" else {
                        "url": app.url, "workspace": str(ws.root),
                        "schema": "starforge.opensanctions-console.v1",
                        **({"connectionFile": connection_file} if connection_file else {}),
                    }
                    print(json.dumps(announcement, ensure_ascii=False, separators=(",", ":")), flush=True)
                    app.serve_forever(poll_interval=0.2)
            finally:
                app.launch = None
                app.server_close()
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
            return
        matching.recover_interrupted(d)
        if args.action == "review-exchanges":
            result = review_exchange.view(d, offset=args.offset, limit=args.limit)
        elif args.action == "review-exchange":
            result = review_exchange.view(d, args.id, offset=args.offset, limit=args.limit)
        elif args.action == "review-exchange-issue":
            result = review_exchange_delivery.issue(d, exchange_input(args.input))
        elif args.action == "review-exchange-command":
            result = review_exchange.command(d, exchange_input(args.input))
        elif args.action == "review-exchange-request":
            result = review_exchange.request(d, args.request_id)
        elif args.action == "review-exchange-compare":
            result = review_exchange.compare(d, args.return_id, args.edition_id, args.adoption_request_id)
        elif args.action in {"review-exchange-return-preview", "review-exchange-retain"}:
            raw = exchange_file(args.input)
            preview = review_exchange.prepare_return(d, raw, Path(args.input).name, args.media)
            if args.action == "review-exchange-retain":
                descriptor = d.put_object(io.BytesIO(raw), Path(args.input).name, args.media,
                                          {"kind": "returned-reviewer-file"})
                result = {"file": {"sha256": descriptor["id"], "bytes": descriptor["bytes"],
                                   "name": Path(args.input).name, "mediaType": args.media}, "preview": preview}
            else:
                result = preview
        elif args.action == "review-exchange-download":
            selected = review_exchange.document(d, args.id, args.role)
            output, raw = Path(args.output), selected["bytes"]
            if output.exists():
                if output.read_bytes() != raw:
                    raise InputError("The selected reviewer output already contains different bytes; choose a new output")
            else:
                private_write(output, raw)
            result = {**selected["descriptor"], "file": str(output)}
        elif args.action == "portfolio-refresh-prepare":
            result = portfolio_refresh.prepare(d, args.before, args.after)
        elif args.action == "portfolio-refreshes":
            result = portfolio_refresh.view(d)
        elif args.action == "portfolio-refresh":
            result = portfolio_refresh.view(d, args.id, offset=args.offset, limit=args.limit, kind=args.kind, query=args.query)
        elif args.action == "portfolio-refresh-command":
            result = portfolio_refresh.command(d, load_json(Path(args.request).read_bytes()))
        elif args.action == "portfolio-refresh-request":
            result = portfolio_refresh.operation(d, args.request_id)
        elif args.action == "portfolio-refresh-report":
            result = portfolio_refresh.report(d, args.id)
            content = portfolio_refresh.report_html(d, args.id).encode() if args.html else json_bytes(result)
            output = Path(args.output)
            if output.exists():
                if output.read_bytes() != content:
                    raise InputError("The selected report snapshot output already contains different bytes; choose a new output")
            else:
                private_write(output, content)
            result = {"comparisonId": args.id, "file": str(output), "bytes": len(content),
                      "sha256": __import__("hashlib").sha256(content).hexdigest()}
        elif args.action == "gleif-preview":
            with Path(args.input).open("rb") as stream:
                original = d.put_object(stream, Path(args.input).name, "application/json")
            result = gleif_portfolio.preview(d, original["id"], offset=args.offset, limit=args.limit)
        elif args.action == "gleif-receive":
            result = gleif_portfolio.receive(d, load_json(Path(args.request).read_bytes()))
        elif args.action == "gleif-intake":
            result = gleif_portfolio.operation(d, args.request_id)
        elif args.action == "portfolio-cycle-reviews":
            result = portfolio_review_cycles.choices(d, args.comparison_id)
        elif args.action == "cycles":
            result = review_cycles.view(d)
        elif args.action == "cycle":
            result = review_cycles.view(d, args.id)
        elif args.action == "cycle-command":
            result = review_cycles.command(d, load_json(Path(args.input).read_bytes()))
        elif args.action == "cycle-report":
            result = review_cycles.report(d, args.id, args.version)
            content = review_cycles.report_html(d, args.id, args.version).encode() if args.html else json_bytes(result)
            output = Path(args.output)
            if output.exists():
                if output.read_bytes() != content:
                    raise InputError("The selected report output already contains different bytes")
            else:
                private_write(output, content)
            result = {"cycleId": args.id, "version": args.version, "file": str(output), "bytes": len(content), "sha256": __import__("hashlib").sha256(content).hexdigest()}
        elif args.action == "state":
            result = d.state()
        elif args.action == "receive-published":
            result = updates.receive_published(d, args.metadata_url)
        elif args.action == "receive-edition":
            with Path(args.metadata).open("rb") as meta, Path(args.entities).open("rb") as entities:
                result = d.accept_edition(meta, entities, metadata_url=args.metadata_url)
        elif args.action == "compare":
            result = d.compare(args.before, args.after)
        elif args.action == "receive-update":
            result = updates.fetch_update(d, args.before, args.after)
        elif args.action == "export":
            result = d.export_packet(Path(args.output))
        else:
            result = d.import_packet(Path(args.input))
        sys.stdout.buffer.write(json_bytes(result))

if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
