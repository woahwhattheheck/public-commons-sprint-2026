"""Operate acquired datasets through the native private DuckDB workspace."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import webbrowser

from .duckdb_dataset import DuckDBWorkspace
from .errors import BuyerError
from .storage import parse, read

_MAX_TEXT = 1024 * 1024


def _json_argument(value, default):
    if value is None:
        return default
    return parse(value.encode("utf-8"))


def _text_file(path):
    return read(Path(path).expanduser(), _MAX_TEXT).decode("utf-8")


def _query_options(parser):
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--sql", help="Read-only SQL over imported tables and active views")
    source.add_argument("--sql-file", help="UTF-8 SQL file")
    parser.add_argument("--parameters", default="[]", help="JSON array of bound SQL parameters")


def _sql(args):
    return args.sql if args.sql is not None else _text_file(args.sql_file)


def _keys(value):
    return [part.strip() for part in value.split(",") if part.strip()] if value else []


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--workspace", "--database", dest="workspace", required=True,
                        help="Private DuckDB workspace directory")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="Read editions, active views, import reviews, saved queries and exports")

    inspect = commands.add_parser("inspect-delivery", help="Review an existing native delivery report")
    inspect.add_argument("report")

    review = commands.add_parser("review", help="Retain an import review with explicit field mapping")
    review.add_argument("report")
    mapping = review.add_mutually_exclusive_group()
    mapping.add_argument("--columns", help='JSON array of {source,name,type,nullable} mappings')
    mapping.add_argument("--columns-file", help="File containing the JSON mapping array")
    review.add_argument("--keys", default="", help="Comma-separated mapped SQL columns identifying a row")

    imported = commands.add_parser("import", help="Import a saved review as an immutable edition")
    imported.add_argument("review_id")

    editions = commands.add_parser("editions", help="Page through retained editions")
    editions.add_argument("--limit", type=int, default=100)
    editions.add_argument("--before", type=int)
    edition = commands.add_parser("edition", help="Reopen an immutable edition")
    edition.add_argument("edition_id")

    activate = commands.add_parser("activate", help="Select an edition through a revisioned SQL view")
    activate.add_argument("name")
    activate.add_argument("edition_id")
    activate.add_argument("--expected-revision", type=int, required=True,
                          help="Current view revision; use 0 to create a view")
    commands.add_parser("views", help="Read active SQL views")

    query = commands.add_parser("query", help="Preview a read-only SQL query")
    _query_options(query)
    query.add_argument("--max-rows", type=int, default=200)
    query.add_argument("--expected-views", help="JSON view bindings from an earlier query preview")

    saved = commands.add_parser("save-query", help="Retain or revise a named SQL recipe")
    saved.add_argument("name")
    _query_options(saved)
    saved.add_argument("--expected-revision", type=int, default=0,
                       help="Current saved query revision; 0 creates a new name")
    commands.add_parser("queries", help="Reopen saved SQL recipes")
    commands.add_parser("reviews", help="Reopen saved import reviews")
    commands.add_parser("exports", help="Read retained query exports")

    exported = commands.add_parser("export", help="Export a saved query as Parquet, CSV and source manifest")
    exported.add_argument("query_id")
    exported.add_argument("--destination", required=True, help="New private directory outside the workspace")
    exported.add_argument("--expected-revision", type=int, required=True)
    exported.add_argument("--expected-views", help="JSON view bindings from the selected query preview")

    compared = commands.add_parser("compare", help="Compare editions by their reviewed record keys")
    compared.add_argument("before_id")
    compared.add_argument("after_id")
    compared.add_argument("--keys", help="Comma-separated compatible reviewed SQL key columns")
    compared.add_argument("--max-rows", type=int, default=200)

    source_files = commands.add_parser("source-files", help="Recover the five retained original files for an edition")
    source_files.add_argument("edition_id")
    source_files.add_argument("--destination", required=True, help="Private directory outside the workspace")

    backup = commands.add_parser("handoff", help="Prepare a complete portable workspace with source files")
    backup.add_argument("--destination", required=True, help="New private directory outside the workspace")

    server = commands.add_parser("serve", help="Open the private local browser operator")
    server.add_argument("--port", type=int, default=0)
    server.add_argument("--open", action="store_true", help="Open the capability URL in the local browser")
    server.add_argument("--export-root", help="Private sibling parent for new query export directories")
    server.add_argument("--handoff-root", help="Private sibling parent for portable source handoffs")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    workspace = None
    try:
        workspace = DuckDBWorkspace(args.workspace)
        if args.command == "status":
            output = {
                "directory": str(workspace.directory),
                "editions": workspace.editions(limit=100),
                "views": workspace.views(),
                "reviews": workspace.reviews(),
                "queries": workspace.queries(),
                "exports": workspace.exports(),
            }
        elif args.command == "inspect-delivery":
            output = workspace.inspect_delivery(args.report)
        elif args.command == "review":
            columns = parse(read(Path(args.columns_file).expanduser(), _MAX_TEXT)) if args.columns_file else _json_argument(args.columns, None)
            output = workspace.review_import(args.report, columns=columns, keys=_keys(args.keys))
        elif args.command == "import":
            output = workspace.import_review(args.review_id)
        elif args.command == "editions":
            output = workspace.editions(limit=args.limit, before=args.before)
        elif args.command == "edition":
            output = workspace.edition(args.edition_id)
        elif args.command == "activate":
            output = workspace.activate(args.name, args.edition_id, expected_revision=args.expected_revision)
        elif args.command == "views":
            output = workspace.views()
        elif args.command == "query":
            output = workspace.query(_sql(args), parameters=_json_argument(args.parameters, []),
                max_rows=args.max_rows, expected_views=_json_argument(args.expected_views, None))
        elif args.command == "save-query":
            output = workspace.save_query(args.name, _sql(args),
                parameters=_json_argument(args.parameters, []), expected_revision=args.expected_revision)
        elif args.command == "queries":
            output = workspace.queries()
        elif args.command == "reviews":
            output = workspace.reviews()
        elif args.command == "exports":
            output = workspace.exports()
        elif args.command == "export":
            output = workspace.export_query(args.query_id, args.destination,
                expected_revision=args.expected_revision,
                expected_views=_json_argument(args.expected_views, None))
        elif args.command == "compare":
            output = workspace.compare(args.before_id, args.after_id,
                keys=_keys(args.keys) if args.keys is not None else None, max_rows=args.max_rows)
        elif args.command == "source-files":
            output = workspace.export_source(args.edition_id, args.destination)
        elif args.command == "handoff":
            output = workspace.backup(args.destination)
        elif args.command == "serve":
            from .duckdb_http import serve
            server, control, url = serve(workspace, port=args.port,
                export_root=args.export_root, handoff_root=args.handoff_root)
            print(json.dumps({"status": "LISTENING", "address": url.split("#", 1)[0],
                              "private_launch": str(control)}, ensure_ascii=False), flush=True)
            if args.open:
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
            return 0
        else:
            raise ValueError("Unknown operator command")
        print(json.dumps(output, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except BuyerError as exc:
        print(json.dumps({"error": exc.code}), file=sys.stderr)
        return 1
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        print(json.dumps({"error": "DUCKDB_OPERATOR_INPUT_OR_STORAGE_ERROR",
                          "detail": str(exc)[:500]}), file=sys.stderr)
        return 1
    except Exception as exc:
        if workspace is not None and isinstance(exc, workspace.duckdb.Error):
            print(json.dumps({"error": "DUCKDB_QUERY_ERROR", "detail": str(exc)[:4096]}), file=sys.stderr)
            return 1
        raise
    finally:
        if workspace is not None:
            workspace.close()


if __name__ == "__main__":
    raise SystemExit(main())
