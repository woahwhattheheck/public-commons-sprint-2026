"""Command line for the complete original Python resource-review workflow."""
from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
import json
from pathlib import Path
import sys

from .errors import BuyerError
from .review_library import ResourceLibrary, ReviewError, ReviewTransferError
from .storage import parse, read


def _print(value):
    if is_dataclass(value):
        value = asdict(value)
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2, default=str))


def _json_file(path):
    value = parse(read(Path(path), 8 * 1024 * 1024))
    if not isinstance(value, dict):
        raise BuyerError("REVIEW_JSON_OBJECT_REQUIRED")
    return value


def parser():
    root = argparse.ArgumentParser(description="Original SF88 resource library, edition review and reviewer returns")
    root.add_argument("--checkout", required=True, help="Absolute original source root")
    root.add_argument("--state", required=True, help="Absolute native library state directory")
    root.add_argument("--node", default="node")
    root.add_argument("--timeout", type=float, default=360)
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Initialize an original source or a portable-review receiver")
    init.add_argument("--receiver", action="store_true")
    init.add_argument("--kind", choices=["inbox", "snapshot", "collection", "paid-jobs"], default="snapshot")
    init.add_argument("--source")
    init.add_argument("--files-root", action="append")
    init.add_argument("--max-file-bytes", type=int)
    init.add_argument("--index-bytes", type=int)
    commands.add_parser("status")
    commands.add_parser("capabilities", help="Actual selected native engine features and action names")
    commands.add_parser("scan")
    resources = commands.add_parser("resources")
    _page(resources)
    resources.add_argument("--query", default="")
    resources.add_argument("--status", default="", choices=["", "VERIFIED", "UNAVAILABLE", "INCOMPLETE"])
    resources.add_argument("--starred", action="store_true")
    resources.add_argument("--all", action="store_true", help="Stream all matching resources as NDJSON")
    resource = commands.add_parser("resource")
    resource.add_argument("id")
    resource.add_argument("--preview", action="store_true")
    resource.add_argument("--history", action="store_true")
    download = commands.add_parser("download")
    download.add_argument("id")
    _download(download)
    annotations = commands.add_parser("annotate")
    annotations.add_argument("id")
    annotations.add_argument("--input", required=True, help="Original expectedRevision/operationId/note/tags/starred JSON")
    export = commands.add_parser("export-resources")
    _download(export)
    collections = commands.add_parser("collection").add_subparsers(dest="subcommand", required=True)
    _page(collections.add_parser("list"))
    for command in ("show", "history"):
        c = collections.add_parser(command)
        c.add_argument("id")
        if command == "show":
            c.add_argument("--revision", type=int)
        else:
            _page(c)
    save = collections.add_parser("save")
    save.add_argument("--input", required=True)
    compare = commands.add_parser("compare").add_subparsers(dest="subcommand", required=True)
    run = compare.add_parser("run", help="Begin and finish the original worker in this process")
    run.add_argument("--before", required=True)
    run.add_argument("--after", required=True)
    run.add_argument("--operation-id", required=True)
    run.add_argument("--format", choices=["auto", "json", "csv", "text", "bytes"], default="auto")
    run.add_argument("--key-column", action="append")
    run.add_argument("--max-input-bytes", type=int)
    run.add_argument("--max-nodes", type=int)
    run.add_argument("--max-changes", type=int)
    _page(compare.add_parser("list"))
    for command in ("show", "wait", "cancel", "resume", "changes", "history", "decide", "export"):
        c = compare.add_parser(command)
        c.add_argument("id")
        if command == "resume":
            c.add_argument("--operation-id", required=True)
        elif command == "changes":
            _page(c)
            c.add_argument("--type", default="")
            c.add_argument("--query", default="")
            c.add_argument("--review", default="")
            c.add_argument("--all", action="store_true")
        elif command == "history":
            c.add_argument("--target")
        elif command == "decide":
            _decision(c)
        elif command == "export":
            _download(c, formats=True)
    receive = compare.add_parser("receive")
    receive.add_argument("--input", required=True)
    receive.add_argument("--sha256")
    receive.add_argument("--operation-id", required=True)
    verify = compare.add_parser("verify")
    verify.add_argument("--input", required=True)
    verify.add_argument("--sha256")
    returns = commands.add_parser("return").add_subparsers(dest="subcommand", required=True)
    stage = returns.add_parser("stage")
    stage.add_argument("--input", required=True)
    stage.add_argument("--sha256")
    stage.add_argument("--operation-id", required=True)
    listing = returns.add_parser("list")
    listing.add_argument("--comparison-id")
    _page(listing)
    for command in ("show", "targets", "history", "choose", "apply", "export"):
        c = returns.add_parser(command)
        c.add_argument("id")
        if command == "targets":
            _page(c)
            c.add_argument("--state-filter", default="")
            c.add_argument("--all", action="store_true")
        elif command == "history":
            _page(c)
            c.add_argument("--target", required=True)
            c.add_argument("--side", choices=["local", "incoming", "choices"], default="incoming")
        elif command == "choose":
            c.add_argument("--target", required=True)
            c.add_argument("--plan", required=True)
            c.add_argument("--expected-revision", required=True, type=int)
            c.add_argument("--operation-id", required=True)
            c.add_argument("--choice", required=True, choices=["KEEP_LOCAL", "TAKE_INCOMING", "CUSTOM"])
            c.add_argument("--actor", required=True)
            c.add_argument("--note", required=True)
            c.add_argument("--status", choices=["ACCEPT", "REJECT", "FOLLOW_UP"])
        elif command == "apply":
            c.add_argument("--plan", required=True)
            c.add_argument("--operation-id", required=True)
        elif command == "export":
            _download(c, formats=True)
    return root


def _page(parser):
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=100)


def _download(parser, formats=False):
    parser.add_argument("--out", required=True)
    parser.add_argument("--transfer-directory")
    parser.add_argument("--chunk-bytes", type=int, default=1024 * 1024)
    if formats:
        parser.add_argument("--format", choices=["json", "csv", "html"], default="json")


def _decision(parser):
    parser.add_argument("--target", default="*")
    parser.add_argument("--expected-revision", required=True, type=int)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--status", required=True, choices=["ACCEPT", "REJECT", "FOLLOW_UP"])
    parser.add_argument("--actor", required=True)
    parser.add_argument("--note", default="")


def _all(items):
    for item in items:
        print(json.dumps(item, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return None


def execute(library, a):
    command, sub = a.command, getattr(a, "subcommand", None)
    if command in ("init", "status"):
        return library.status()
    if command == "capabilities":
        return {"node": library.runtime["node"], "features": library.capabilities, "actions": library.runtime["actions"]}
    if command == "scan":
        return library.scan()
    if command == "resources":
        filters = dict(q=a.query, status=a.status, starred=a.starred)
        return _all(library.iter_resources(page_size=a.limit, **filters)) if a.all else library.search(offset=a.offset, limit=a.limit, **filters)
    if command == "resource":
        return library.annotation_history(a.id) if a.history else library.preview(a.id) if a.preview else library.resource(a.id)
    if command == "annotate":
        return library.invoke("annotation.save", {"id": a.id, "input": _json_file(a.input)})
    if command in ("download", "export-resources"):
        options = dict(transfer_directory=a.transfer_directory, chunk_bytes=a.chunk_bytes)
        return library.download_resource(a.id, a.out, **options) if command == "download" else library.export_resource_review(a.out, **options)
    if command == "collection":
        if sub == "list":return library.collections(offset=a.offset, limit=a.limit)
        if sub == "show":return library.collection(a.id, revision=a.revision)
        if sub == "history":return library.collection_history(a.id, offset=a.offset, limit=a.limit)
        return library.invoke("collections.save", _json_file(a.input))
    if command == "compare":
        if sub == "run":
            return library.compare(a.before, a.after, operation_id=a.operation_id, format=a.format,
                key_columns=a.key_column, max_input_bytes=a.max_input_bytes, max_nodes=a.max_nodes,
                max_changes=a.max_changes).observed
        if sub == "list":return library.comparisons(offset=a.offset, limit=a.limit)
        if sub == "receive":return library.import_review(a.input, operation_id=a.operation_id, expected_sha256=a.sha256).observed
        if sub == "verify":return library.verify_review(a.input, expected_sha256=a.sha256)
        c = library.comparison(a.id)
        if sub == "show":return c.observed
        if sub == "wait":return c.wait()
        if sub == "cancel":return c.cancel()
        if sub == "resume":return c.resume(operation_id=a.operation_id)
        if sub == "history":return c.history(target=a.target)
        if sub == "changes":
            filters = dict(type=a.type, q=a.query, review=a.review)
            return _all(c.iter_changes(page_size=a.limit, **filters)) if a.all else c.changes(offset=a.offset, limit=a.limit, **filters)
        if sub == "decide":return c.decide(target=a.target, expected_revision=a.expected_revision,
            operation_id=a.operation_id, status=a.status, actor=a.actor, note=a.note)
        if sub == "export":return c.export(a.out, format=a.format,
            transfer_directory=a.transfer_directory, chunk_bytes=a.chunk_bytes)
    if command == "return":
        if sub == "stage":return library.stage_return(a.input, operation_id=a.operation_id, expected_sha256=a.sha256).observed
        if sub == "list":return library.returns(comparison_id=a.comparison_id, offset=a.offset, limit=a.limit)
        r = library.review_return(a.id)
        if sub == "show":return r.observed
        if sub == "targets":return _all(r.iter_targets(page_size=a.limit, state=a.state_filter)) if a.all else r.targets(offset=a.offset, limit=a.limit, state=a.state_filter)
        if sub == "history":
            options = dict(target=a.target, offset=a.offset, limit=a.limit)
            return r.choice_history(**options) if a.side == "choices" else r.decision_history(side=a.side, **options)
        if sub == "choose":return r.choose(target=a.target, plan_sha256=a.plan,
            expected_revision=a.expected_revision, operation_id=a.operation_id, choice=a.choice,
            actor=a.actor, note=a.note, status=a.status)
        if sub == "apply":return r.apply(plan_sha256=a.plan, operation_id=a.operation_id)
        if sub == "export":return r.export_original(a.out, format=a.format,
            transfer_directory=a.transfer_directory, chunk_bytes=a.chunk_bytes)
    raise BuyerError("REVIEW_COMMAND_INVALID")


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    options = dict(checkout=args.checkout, state=args.state, node=args.node, timeout=args.timeout)
    try:
        if args.command == "init":
            if args.receiver:
                if args.source or args.files_root:
                    p.error("--receiver uses its own original empty source; omit --source and --files-root")
                library = ResourceLibrary.receiver(**options)
            else:
                if not args.source or not args.files_root:
                    p.error("source initialization needs --source and --files-root")
                library = ResourceLibrary(**options, kind=args.kind, source=args.source,
                    roots=args.files_root, max_file_bytes=args.max_file_bytes, index_bytes=args.index_bytes)
        else:
            library = ResourceLibrary(**options)
        with library:
            result = execute(library, args)
            if result is not None:
                _print(result)
        return 0
    except (BuyerError, OSError) as error:
        result = {"error": getattr(error, "code", "REVIEW_IO_ERROR")}
        if isinstance(error, ReviewError):
            result.update(action=error.action, operationId=error.operation_id, dispatched=error.dispatched)
            if error.result is not None:
                result["nativeResult"] = error.result
        if isinstance(error, ReviewTransferError):
            result["transfer"] = asdict(error.progress)
        print(json.dumps(result, ensure_ascii=False, default=str), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
