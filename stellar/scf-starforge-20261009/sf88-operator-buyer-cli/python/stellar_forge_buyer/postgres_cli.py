"""Operate complete original SF100 deliveries in a customer PostgreSQL warehouse."""
from __future__ import annotations

import argparse
from datetime import date, datetime
from decimal import Decimal
import json
import os
from pathlib import Path
import sys

from .datasets import DatasetAcquisition, DatasetDelivery
from .errors import BuyerError
from .postgres_delivery import DatasetMapping, PostgresWarehouse, WarehouseError, review_delivery
from .storage import digest, parse, private_directory, read, write


def _encode(value):
    # Decimal is emitted as exact text in the command JSON, matching the mapping.
    # It is never converted to a binary float for presentation.
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def _delivery(args):
    if args.report:
        raw = parse(read(Path(args.report), 8 * 1024 * 1024))
        report = raw.get("report") if isinstance(raw, dict) and isinstance(raw.get("report"), dict) else raw
        if not isinstance(report, dict) or not isinstance(report.get("directory"), str):
            raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_REPORT_REQUIRED")
        directory = Path(report["directory"])
        if not directory.is_absolute() or str(directory) != report["directory"]:
            raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_DIRECTORY_INVALID")
        if args.checkout or args.delivery:
            raise WarehouseError("DATASET_PG_ONE_DELIVERY_SOURCE_REQUIRED")
        return DatasetDelivery(native=report, directory=directory)
    if not args.checkout or not args.delivery:
        raise WarehouseError("DATASET_PG_CHECKOUT_AND_DELIVERY_REQUIRED_FOR_SESSION")
    return DatasetAcquisition(checkout=args.checkout, session=args.session, node=args.node).deliver(args.delivery)


def _save(destination, data):
    path = Path(os.path.abspath(Path(destination).expanduser()))
    if private_directory(path.parent, create=False) != path.parent:
        raise WarehouseError("DATASET_PG_PRIVATE_OUTPUT_PARENT_REQUIRED")
    write(path, data, exclusive=True)
    return {"path": str(path), "bytes": len(data), "sha256": digest(data)}


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection-env", default="SF_BUYER_POSTGRES_DSN",
                        help="existing environment variable containing libpq connection settings")
    parser.add_argument("--schema", default="sf_received", help="dedicated receiving schema")
    parser.add_argument("--expect-warehouse", help="previously observed warehouse_id")
    parser.add_argument("--statement-timeout-ms", type=int, default=300000)
    parser.add_argument("--lock-timeout-ms", type=int, default=30000)
    parser.add_argument("--out", help="save command JSON as a new private file")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="create an empty dedicated receiving schema or reopen its original identity")
    commands.add_parser("status", help="read retained editions, views and PostgreSQL version")
    for name in ("review", "import"):
        command = commands.add_parser(name, help="review complete verified rows offline" if name == "review" else "commit complete original rows as one retained edition")
        source = command.add_mutually_exclusive_group(required=True)
        source.add_argument("--report", help="original native dataset-delivery JSON report")
        source.add_argument("--session", help="original complete SF88 acquisition directory")
        command.add_argument("--checkout", help="original runtime checkout, with --session")
        command.add_argument("--delivery", help="original SF100 data-room directory, with --session")
        command.add_argument("--node", default="node")
        command.add_argument("--mapping", required=True)
        if name == "import":
            command.add_argument("--expect-version", help="version_id from this original delivery and reviewed mapping")
    versions = commands.add_parser("versions", help="page retained immutable editions")
    versions.add_argument("--before", type=int)
    versions.add_argument("--limit", type=int, default=100)
    version = commands.add_parser("version", help="inspect one retained edition and exact mapping")
    version.add_argument("version_id")
    current = commands.add_parser("current", help="read a named application view and its current revision")
    current.add_argument("name")
    activate = commands.add_parser("activate", help="select a retained edition for the application's stable view")
    activate.add_argument("name")
    activate.add_argument("version_id")
    activate.add_argument("--expected-revision", required=True, type=int)
    history = commands.add_parser("history", help="page prior selections of one application view")
    history.add_argument("name")
    history.add_argument("--before", type=int)
    history.add_argument("--limit", type=int, default=100)
    rows = commands.add_parser("rows", help="read an edition in retained original row order")
    rows.add_argument("version_id")
    rows.add_argument("--after", type=int, default=0)
    rows.add_argument("--limit", type=int, default=100)
    rows.add_argument("--include-original", action="store_true")
    compare = commands.add_parser("compare", help="compare all rows by declared keys using PostgreSQL")
    compare.add_argument("previous")
    compare.add_argument("current")
    compare.add_argument("--offset", type=int, default=0)
    compare.add_argument("--limit", type=int, default=100)
    manifest = commands.add_parser("manifest", help="save a retained edition's exact original SF100 manifest")
    manifest.add_argument("version_id")
    manifest.add_argument("--destination", required=True)
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        if args.command in {"review", "import"}:
            mapping = DatasetMapping.from_record(parse(read(Path(args.mapping), 1024 * 1024)))
            delivery = _delivery(args)
        if args.command == "review":
            output = review_delivery(delivery, mapping)
        else:
            warehouse = PostgresWarehouse.from_environment(
                args.connection_env, schema=args.schema, create=args.command == "init",
                expected_warehouse=args.expect_warehouse,
                statement_timeout_ms=args.statement_timeout_ms, lock_timeout_ms=args.lock_timeout_ms)
            if args.command in {"init", "status"}:
                output = warehouse.status()
            elif args.command == "import":
                output = warehouse.import_delivery(delivery, mapping, expected_version=args.expect_version)
            elif args.command == "versions":
                output = warehouse.versions(before=args.before, limit=args.limit)
            elif args.command == "version":
                output = warehouse.version(args.version_id)
            elif args.command == "current":
                output = warehouse.current(args.name)
            elif args.command == "activate":
                output = warehouse.activate(args.name, args.version_id, expected_revision=args.expected_revision)
            elif args.command == "history":
                output = warehouse.history(args.name, before=args.before, limit=args.limit)
            elif args.command == "rows":
                output = warehouse.rows(args.version_id, after=args.after, limit=args.limit, include_original=args.include_original)
            elif args.command == "compare":
                output = warehouse.compare(args.previous, args.current, offset=args.offset, limit=args.limit)
            else:
                saved = _save(args.destination, warehouse.manifest_bytes(args.version_id))
                output = {"status": "MANIFEST_SAVED", "version_id": args.version_id, **saved}
        encoded = (json.dumps(output, ensure_ascii=False, allow_nan=False, indent=2, default=_encode) + "\n").encode()
        if args.out:
            print(json.dumps({"status": "SAVED", **_save(args.out, encoded)}))
        else:
            sys.stdout.write(encoded.decode())
        return 0
    except WarehouseError as error:
        print(json.dumps(error.report()), file=sys.stderr)
        return 2
    except BuyerError as error:
        print(json.dumps({"error": error.code}), file=sys.stderr)
        return 2
    except FileExistsError:
        print(json.dumps({"error": "DATASET_PG_OUTPUT_ALREADY_EXISTS"}), file=sys.stderr)
        return 2
    except OSError:
        print(json.dumps({"error": "DATASET_PG_LOCAL_FILE_OPERATION_FAILED"}), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(json.dumps({"error": "DATASET_PG_OPERATION_INTERRUPTED", "recovery": "reopen the same warehouse and original version_id"}), file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
