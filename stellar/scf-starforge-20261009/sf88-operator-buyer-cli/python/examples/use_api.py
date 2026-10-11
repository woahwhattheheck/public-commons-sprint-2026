"""A customer workflow for native uploads, retained records and paid-file delivery."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from stellar_forge_buyer import Buyer, BuyerError, DeliveryError


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True, help="Installed original Commons runtime checkout")
    parser.add_argument("--state", required=True, help="Private customer operation directory")
    parser.add_argument("--timeout", type=int, default=360, help="Whole original subprocess deadline in seconds")
    actions = parser.add_subparsers(dest="action", required=True)

    prepare = actions.add_parser("prepare", help="Select an observed offer, author the request and save native review")
    prepare.add_argument("--discovery", required=True)
    prepare.add_argument("--row", type=int, required=True)
    prepare.add_argument("--accept", type=int, required=True)
    prepare.add_argument("--intent", required=True)
    prepare.add_argument("--url", required=True)
    prepare.add_argument("--method", choices=["GET", "POST", "PUT", "PATCH", "DELETE"], default="POST")
    request = prepare.add_mutually_exclusive_group()
    request.add_argument("--multipart", help="Native selection JSON: fields plus files with absolute paths")
    request.add_argument("--body", help="Exact request byte file")
    prepare.add_argument("--headers", help="JSON object of native allowed request headers")
    prepare.add_argument("--profile", help="Existing trusted original operator paths and settings")
    prepare.add_argument("--request-timeout-ms", type=int, default=180000)
    prepare.add_argument("--response-timeout-ms", type=int, default=120000)
    prepare.add_argument("--max-response-bytes", type=int, default=67108864)
    prepare.add_argument("--format", choices=["sse", "ndjson"])

    prepare_file = actions.add_parser("prepare-file", help="Prepare the original merchant's paid-file handoff")
    prepare_file.add_argument("--workspace", required=True)
    prepare_file.add_argument("--handoff", required=True)
    prepare_file.add_argument("--intent")

    for name in ["execute", "recover"]:
        command = actions.add_parser(name)
        command.add_argument("--intent", required=True)
        command.add_argument("--format", choices=["sse", "ndjson"])
        command.add_argument("--partial", action="store_true", help="Inspect original complete frames in a failed capture")
        command.add_argument("--records", help="Create a private copy of the typed records JSONL")
        command.add_argument("--start", type=int, default=0, help="Original record index for resumed application consumption")

    inspect_file = actions.add_parser("inspect-file", help="Inspect the original durable file-transfer state")
    inspect_file.add_argument("--intent", required=True)
    resume = actions.add_parser("resume-file", help="Recover or resume the same original entitlement delivery")
    resume.add_argument("--intent", required=True)
    resume.add_argument("--destination", help="Destination on the first retrieval; retain it thereafter")
    resume.add_argument("--claim-env", default="SF101_CLAIM_TOKEN")
    resume.add_argument("--transfer-timeout-ms", type=int, default=120000)
    return parser.parse_args()


def json_file(value):
    from stellar_forge_buyer.storage import parse, read
    return parse(read(Path(value).expanduser().absolute(), 1_048_576))


def consume(result, args):
    summary = {"intentId": result.native.get("intentId"), "status": result.status,
               "httpStatus": result.native.get("httpStatus"), "delivery": result.delivery,
               "returncode": result.record.get("returncode"), "runtimeError": result.record.get("runtimeError")}
    format = args.format or (result.stream or {}).get("format")
    if format:
        exported = result.export_stream(format=format, allow_partial=args.partial)
        consumed = 0
        # Replace this local consumer with the application's own use of the
        # typed records. Keep record.index with its downstream checkpoint.
        for record in exported.records(start=args.start):
            consumed += 1
        summary["records"] = {"format": exported.format, "complete": exported.complete,
                              "count": exported.count, "consumed": consumed, "start": args.start,
                              "directory": str(exported.directory)}
        if args.records:
            summary["records"]["savedAs"] = str(exported.file.save_as(args.records))
    return summary


def main():
    args = arguments()
    buyer = Buyer(checkout=args.checkout, state_dir=args.state, timeout=args.timeout)
    try:
        if args.action == "prepare":
            body = None
            if args.body:
                from stellar_forge_buyer.requests import MAX_REQUEST_BODY_BYTES
                from stellar_forge_buyer.storage import read
                body = read(Path(args.body).expanduser().absolute(), MAX_REQUEST_BODY_BYTES)
            operation = buyer.prepare(args.discovery, row=args.row, accept=args.accept,
                intent_id=args.intent, url=args.url, method=args.method, body=body,
                headers=json_file(args.headers) if args.headers else None,
                multipart=json_file(args.multipart) if args.multipart else None)
            operation.configure(args.profile, request_timeout_ms=args.request_timeout_ms,
                response_timeout_ms=args.response_timeout_ms, max_response_bytes=args.max_response_bytes,
                response_stream={"format": args.format} if args.format else None)
            output = {"intentId": operation.intent_id, "review": operation.review().native}
        elif args.action == "prepare-file":
            operation = buyer.from_paid_file(args.handoff, workspace=args.workspace, intent_id=args.intent)
            review = operation.review()
            output = {"intentId": operation.intent_id, "review": review.native, "filePromise": review.file_promise}
        else:
            operation = buyer.operation(args.intent)
            if args.action == "inspect-file":
                transfer = operation.inspect_file_transfer()
                output = {"status": transfer.status, "retainedBytes": transfer.retained_bytes,
                          "expectedBytes": transfer.expected_bytes, "resumable": transfer.resumable,
                          "destination": str(transfer.destination)}
            elif args.action == "resume-file":
                delivery = operation.recover_file()
                if delivery is None:
                    delivery = operation.retrieve_file(destination=args.destination, resume=True,
                        claim_env=args.claim_env, timeout_ms=args.transfer_timeout_ms)
                # Verify the completed original product before presenting it.
                with delivery.open():
                    pass
                output = {"status": delivery.status, "file": delivery.delivery,
                          "resumedBytes": delivery.resumed_bytes, "httpRequests": delivery.http_requests}
            else:
                result = (operation.execute(review=operation.review()) if args.action == "execute"
                          else operation.recover())
                output = {"status": "ORIGINAL_RESULT_NOT_RECORDED", "intentId": args.intent} if result is None else consume(result, args)
        print(json.dumps(output, ensure_ascii=False, indent=2))
    except DeliveryError as error:
        print(json.dumps({"error": error.code, "partialPath": error.partial_path,
                          "retainedBytes": error.retained_bytes, "resumable": error.resumable}))
        return 2
    except BuyerError as error:
        print(json.dumps({"error": error.code}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
