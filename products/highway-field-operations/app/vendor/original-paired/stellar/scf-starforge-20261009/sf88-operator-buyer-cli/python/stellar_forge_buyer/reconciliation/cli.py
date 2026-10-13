"""Paired reconciliation commands borrowed by the original DuckDB CLI."""
from __future__ import annotations

from pathlib import Path

from ..storage import parse, read
from .contracts import fields
from .model import Reconciliation


def add_parser(commands):
    parser = commands.add_parser("reconcile", help="Review paired editions, account for every row and retain engineer reports")
    actions = parser.add_subparsers(dest="reconciliation_command", required=True)
    actions.add_parser("status")
    review = actions.add_parser("review", help="Read all source/target mapping and window contracts")
    review.add_argument("--definition", required=True, help="UTF-8 JSON definition file; no mutation")
    for kind in ("pairs", "runs", "reports", "operations"):
        item = actions.add_parser(kind)
        item.add_argument("--offset", type=int, default=0)
        item.add_argument("--limit", type=int, default=25)
        if kind == "runs":
            item.add_argument("--pair-id")
        if kind == "reports":
            item.add_argument("--run-id")
    for kind in ("pair", "run-read", "report-read", "request"):
        item = actions.add_parser(kind)
        item.add_argument("id")
        if kind == "pair":
            item.add_argument("--revision", type=int)
    for kind in ("save-pair", "run", "decision", "report"):
        item = actions.add_parser(kind, help="Retain exact request_id/workspace_id and native revision before dispatch")
        item.add_argument("--request-file", required=True, help="Original JSON body with stable request and workspace IDs")
    resume = actions.add_parser("resume", help="Explicitly continue the original retained reconciliation request")
    resume.add_argument("id")
    resume.add_argument("--workspace-id", required=True)
    for kind in ("groups", "rows", "decisions", "changes"):
        item = actions.add_parser(kind)
        item.add_argument("id", help="Run ID, or immutable report ID for changes")
        item.add_argument("--offset", type=int, default=0)
        item.add_argument("--limit", type=int, default=25)
        if kind == "groups":
            item.add_argument("--category")
            item.add_argument("--duplicates", choices=("true", "false"))
        if kind == "rows":
            item.add_argument("--side", choices=("source", "target"))
            item.add_argument("--status", choices=("INCLUDED", "QUARANTINED", "EXCLUDED_WINDOW"))
            item.add_argument("--group-id", type=int)
    row = actions.add_parser("row")
    row.add_argument("id")
    row.add_argument("--side", choices=("source", "target"), required=True)
    row.add_argument("--row", type=int, required=True)
    exported = actions.add_parser("export", help="Full original query/source/warehouse handoff; original HTTP owner must be closed")
    exported.add_argument("--request-file", required=True, help="Exact JSON {request_id,report_id}")
    exported.add_argument("--export-root", help="Host-selected private export parent outside the warehouse")
    for kind in ("export-request", "resume-export"):
        item = actions.add_parser(kind, help="Inspect/resume the same original native export journal")
        item.add_argument("id")
        item.add_argument("--export-root")


def _body(path):
    return parse(read(Path(path).expanduser(), 1024 * 1024))


def dispatch(workspace, args):
    native, action = Reconciliation(workspace), args.reconciliation_command
    if action == "status":
        return native.status()
    if action == "review":
        return native.review(_body(args.definition))
    if action in {"pairs", "runs", "reports", "operations"}:
        options = {"offset": args.offset, "limit": args.limit}
        if action == "runs":
            options["pair_id"] = args.pair_id
        if action == "reports":
            options["run_id"] = args.run_id
        return native.catalog(action, **options)
    if action == "pair":
        return native.pair(args.id, args.revision)
    if action in {"run-read", "report-read", "request"}:
        return getattr(native, {"run-read": "run", "report-read": "report", "request": "request"}[action])(args.id)
    if action in {"save-pair", "run", "decision", "report"}:
        return native.perform("pairs" if action == "save-pair" else action, _body(args.request_file))
    if action == "resume":
        return native.resume(args.id, args.workspace_id)
    if action in {"groups", "rows"}:
        options = {"offset": args.offset, "limit": args.limit}
        if action == "groups":
            options.update(category=args.category,
                           duplicates=None if args.duplicates is None else args.duplicates == "true")
        else:
            options.update(side=args.side, status=args.status, group_id=args.group_id)
        return native.grid(args.id, action, **options)
    if action in {"decisions", "changes"}:
        return getattr(native, action)(args.id, offset=args.offset, limit=args.limit)
    if action == "row":
        return native.row(args.id, args.side, args.row)
    # The original native retained journal and lock own both browser and CLI
    # export lifetimes. A live existing HTTP owner is an explicit conflict.
    from ..duckdb_http import DuckDBOperator
    from ..duckdb_agent import request_record
    operator = DuckDBOperator(workspace, export_root=args.export_root)
    try:
        if action == "export":
            return operator.perform("/api/reconciliation/exports", _body(args.request_file))
        if action == "export-request":
            return request_record(operator, args.id)
        return operator.resume(args.id)
    finally:
        operator.close()
