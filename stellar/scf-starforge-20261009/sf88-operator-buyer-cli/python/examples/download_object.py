"""Prepare, continue and consume an actual original merchant object from Python."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys

from stellar_forge_buyer import BuyerError
from stellar_forge_buyer.objects import ObjectBuyer, ObjectDownloadError


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--checkout", required=True, help="Complete original runtime checkout")
    common.add_argument("--session", required=True, help="Private native object session directory")
    common.add_argument("--timeout", type=int, default=360, help="Native subprocess seconds, up to 3600")
    actions = parser.add_subparsers(dest="action", required=True)
    prepare = actions.add_parser("prepare", parents=[common], help="Select one original objects.json row offline")
    prepare.add_argument("--description", required=True)
    prepare.add_argument("--object", required=True)
    prepare.add_argument("--max-total-atomic", required=True)
    prepare.add_argument("--chunk-bytes", type=int)
    prepare.add_argument("--workspace")
    prepare.add_argument("--config")
    status = actions.add_parser("status", parents=[common])
    status.add_argument("--chunk-offset", type=int, default=0)
    status.add_argument("--chunk-limit", type=int, default=50)
    run = actions.add_parser("run", parents=[common], help="Continue native requests in an operator terminal")
    run.add_argument("--workspace")
    actions.add_parser("recover", parents=[common], help="Reopen saved native outcomes without HTTP")
    download = actions.add_parser("download", parents=[common], help="Continue and return the complete application file")
    download.add_argument("--out", required=True)
    download.add_argument("--workspace")
    assemble = actions.add_parser("assemble", parents=[common])
    assemble.add_argument("--out", required=True)
    consume = actions.add_parser("consume", parents=[common], help="Consume an already assembled file locally")
    consume.add_argument("--out", help="Exact recorded destination, or the latest assembly when omitted")
    consume.add_argument("--as", dest="kind", choices=["binary", "csv", "json"], default="binary")
    consume.add_argument("--read-limit", type=int, default=8_388_608, help="Maximum bytes for JSON materialization")
    report = actions.add_parser("report", parents=[common])
    report.add_argument("--out", required=True)
    report.add_argument("--format", choices=["html", "json"], default="html")
    return parser.parse_args(argv)


def consume_file(delivery, kind, read_limit):
    if kind == "csv":
        rows, columns = 0, None
        # Replace this loop with the application's import_row(row). The existing
        # reader verifies the saved file, then yields rows without materializing it.
        for row in delivery.csv_rows():
            rows += 1
            if columns is None:
                columns = list(row)
        consumed = {"kind": "csv", "rows": rows, "columns": columns or []}
    elif kind == "json":
        value = delivery.json(limit=read_limit)
        consumed = {"kind": "json", "rootType": type(value).__name__,
                    "entries": len(value) if isinstance(value, (dict, list)) else 1}
    else:
        digest, count = hashlib.sha256(), 0
        with delivery.open() as stream:
            while chunk := stream.read(1_048_576):
                # Feed the same verified stream to the application's importer,
                # archive reader or upload SDK here.
                digest.update(chunk)
                count += len(chunk)
        consumed = {"kind": "binary", "consumedBytes": count, "consumedSha256": digest.hexdigest()}
    return {"localConsumption": consumed, "path": str(delivery.path),
            "assembly": delivery.assembly, "sessionId": delivery.session_id}


def main(argv=None):
    args = arguments(argv)
    buyer = ObjectBuyer(checkout=args.checkout, timeout=args.timeout)
    if args.action == "prepare":
        session = buyer.prepare(args.session, description_file=args.description,
            object_id=args.object, max_total_atomic=args.max_total_atomic,
            config_file=args.config, workspace=args.workspace, chunk_bytes=args.chunk_bytes)
        result = session.last_report.to_dict()
    else:
        session = buyer.open(args.session)
        if args.action == "status":
            report = session.last_report if (args.chunk_offset, args.chunk_limit) == (0, 50) else \
                session.inspect(chunk_offset=args.chunk_offset, chunk_limit=args.chunk_limit)
            result = report.to_dict()
        elif args.action in ("run", "recover"):
            report = session.run(workspace=args.workspace) if args.action == "run" else session.recover()
            print(json.dumps(report.to_dict(), indent=2))
            return 0 if report.complete or args.action == "recover" and report.status == "READY" else 2
        elif args.action in ("download", "assemble"):
            delivery = session.download(args.out, workspace=args.workspace) if args.action == "download" else \
                session.assemble(args.out)
            result = {"path": str(delivery.path), "assembly": delivery.assembly,
                      "sessionId": delivery.session_id, "receiptRecorded": delivery.receipt_recorded}
        elif args.action == "consume":
            result = consume_file(session.delivery(args.out), args.kind, args.read_limit)
        else:
            result = {"report": str(session.export_report(args.out, format=args.format))}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ObjectDownloadError as error:
        print(json.dumps({"error": error.code, "session": str(error.operation.directory),
                          "progress": error.progress.to_dict()}, indent=2), file=sys.stderr)
        raise SystemExit(2)
    except BuyerError as error:
        print(json.dumps({"error": error.code, "session":
            str(error.operation.directory) if error.operation else None}), file=sys.stderr)
        raise SystemExit(1)
    except OSError:
        print(json.dumps({"error": "LOCAL_OBJECT_FILE_UNAVAILABLE"}), file=sys.stderr)
        raise SystemExit(1)
