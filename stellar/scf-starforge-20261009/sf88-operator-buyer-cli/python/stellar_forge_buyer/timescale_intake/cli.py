"""Commands for original Timescale report intake and paired customer review."""
from __future__ import annotations

from pathlib import Path
from ..storage import digest, parse, private_directory, sync_directory, write
from .model import TimescaleIntake, report_bytes
from .source import (CommissioningReport, filename, hash_id, need, read_original,
                     request_id, fields)

_MAX_INPUT = 1024 * 1024


def add_parser(commands):
    parent = commands.add_parser("timescale-intake",
        help="Retain exact original Timescale commissioning reports, review native mappings and create paired reconciliation")
    actions = parent.add_subparsers(dest="timescale_action", required=True)
    actions.add_parser("status", help="Read the same original warehouse identity and intake counts")
    inspected = actions.add_parser("inspect", help="Validate all original report records without retaining or importing")
    inspected.add_argument("--file", required=True)
    inspected.add_argument("--sha256", required=True)
    inspected.add_argument("--filename")
    for name in ("reports", "reviews", "operations"):
        page = actions.add_parser(name, help="Page retained " + name)
        page.add_argument("--offset", type=int, default=0)
        page.add_argument("--limit", type=int, default=25)
    report = actions.add_parser("report", help="Read an original retained report and all source descriptors")
    report.add_argument("report_id")
    source = actions.add_parser("source", help="Page every row in a selected original native table")
    source.add_argument("report_id")
    source.add_argument("source_id")
    source.add_argument("--offset", type=int, default=0)
    source.add_argument("--limit", type=int, default=25)
    source.add_argument("--q", default="", help="Display search only; never changes imported row scope")
    for name, help_text in {
        "retain": "Retain an exact original private report by path/SHA and stable request ID",
        "review": "Save a complete original column/type/role/meaning review",
        "import": "Import the exact reviewed source as an immutable native edition",
        "pair-review": "Review two original Timescale editions through the existing paired engine",
        "pair": "Save the reviewed pair under the original request journal and revision CAS",
    }.items():
        command = actions.add_parser(name, help=help_text)
        command.add_argument("--input", required=True, help="Private UTF-8 JSON body, at most 1 MiB; original request/workspace IDs are explicit")
    operation = actions.add_parser("request", help="Inspect an original operation; this never resumes it")
    operation.add_argument("request_id")
    resume = actions.add_parser("resume", help="Explicitly resume the exact retained original operation")
    resume.add_argument("request_id")
    resume.add_argument("--workspace-id", required=True)
    downloaded = actions.add_parser("report-file", help="Recover the complete exact original report from the warehouse")
    downloaded.add_argument("report_id")
    downloaded.add_argument("--destination", required=True, help="Private file outside the warehouse; identical existing bytes can be reopened")


def dispatch(workspace, args):
    native, action = TimescaleIntake(workspace), args.timescale_action
    if action == "status":
        return native.status()
    if action == "inspect":
        report = CommissioningReport(read_original(args.file), hash_id(args.sha256))
        return {**report.summary(filename(args.filename or Path(args.file).name)), "sources": report.descriptors()}
    if action in {"reports", "reviews", "operations"}:
        return getattr(native, action)(offset=args.offset, limit=args.limit)
    if action == "report":
        return native.report(args.report_id)
    if action == "source":
        return native.source(args.report_id, args.source_id, offset=args.offset, limit=args.limit, q=args.q)
    if action == "request":
        return native.request(args.request_id)
    if action == "resume":
        return native.resume(args.request_id, request_id(args.workspace_id))
    if action == "report-file":
        raw, original = report_bytes(workspace, hash_id(args.report_id))
        path = Path(args.destination).expanduser().absolute()
        need(path.parent.resolve() == path.parent and path != workspace.directory
             and not path.is_relative_to(workspace.directory), "PRIVATE_OUTPUT_OUTSIDE_WORKSPACE_REQUIRED")
        private_directory(path.parent)
        if path.exists():
            need(read_original(path) == raw, "ORIGINAL_OUTPUT_CHANGED")
            sync_directory(path.parent)
        else:
            write(path, raw, exclusive=True)
        return {"schema": "stellar-forge.duckdb-timescale-intake.v1.file", "report_id": args.report_id,
                "path": str(path), "filename": original["filename"], "bytes": len(raw),
                "sha256": digest(raw), "complete": True}
    body = parse(read_original(args.input, _MAX_INPUT))
    if action == "retain":
        return native.retain_path(body)
    if action == "review":
        return native.review(body)
    if action == "import":
        return native.import_review(body)
    if action == "pair-review":
        fields(body, ("definition",))
        return native.pair_review(body["definition"])
    if action == "pair":
        return native.pair(body)
    raise ValueError("Unknown Timescale intake command")
